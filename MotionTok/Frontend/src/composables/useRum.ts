/**
 * RUM(Real User Monitoring) — 실제 사용자 브라우저에서 재는 지표 (S15P11A706-153).
 *
 * ## 왜 필요한가
 * 서버 로그는 <b>서버에 도달한 것</b>만 본다. 베타에서 가장 알고 싶은 것 상당수가 그 바깥에 있다 —
 * 커넥션 고갈로 접속 자체가 거부된 사람, MediaPipe를 받다가 포기한 사람, 클라가 몇 번
 * 재연결을 시도했는지, 서버는 100ms인데 클라 체감은 몇 초였는지.
 *
 * ## 수신은 nginx가 직접 한다
 * `location = /rum` 이 `return 204`로 끝내고 access log에만 남긴다. 앱을 거치지 않으므로
 * <b>앱이 죽어도 기록되고</b>(우리가 가장 알고 싶은 순간이 정확히 그때다),
 * 문제가 생기면 nginx reload 한 번으로 끌 수 있다 — 프론트 재배포가 필요 없다.
 *
 * ## 원칙 — 관측이 부하가 되면 안 된다
 * - <b>60초 배치.</b> 요청당 전송은 하지 않는다
 * - <b>실패해도 재시도하지 않는다.</b> 재시도가 폭주를 만든다
 * - 전부 try/catch. RUM이 앱을 망가뜨리면 본말전도다
 * - HTTP/2라 기존 커넥션에 스트림 하나만 얹는다 — 새 커넥션이 생기지 않는다
 *
 * ## 개인정보
 * `rid`는 <b>이 모듈이 만드는 난수</b>다. JWT의 세션 ID와 무관하고 그것으로 아무것도 할 수 없다.
 * 닉네임·채팅 내용·userId는 보내지 않는다. 용도는 "같은 사람의 로그 줄을 묶는 것" 하나뿐이다.
 */
const RUM_ENDPOINT = '/rum'
const BEAT_INTERVAL_MS = 60_000
/** 첫 화면이 자리를 잡고 보낸다 — 로드 직후엔 navigation timing이 아직 확정되지 않는다. */
const BOOT_DELAY_MS = 3_000
/** 배치당 보관하는 API 표본 상한. 넘으면 오래된 것부터 버린다(메모리 상한). */
const API_SAMPLE_MAX = 300
/**
 * 세션당 보낼 에러 개수 상한.
 *
 * <p>에러는 보통 <b>루프로 터진다</b> — 렌더 루프나 프레임 콜백 안에서 나면 초당 수십 번이다.
 * 상한이 없으면 에러 보고가 그대로 비콘 폭주가 되어, 관측이 부하를 만드는 바로 그 상황이 된다.
 * 같은 메시지는 한 번만 보내는 것과 합쳐 두 겹으로 막는다.</p>
 */
const ERR_MAX_PER_SESSION = 5

let rid = ''
let started = false
let beatTimer: ReturnType<typeof setInterval> | undefined
let apiTimings: number[] = []
let disconnects = 0
let errCount = 0
const seenErrors = new Set<string>()

/**
 * 카운터를 이 모듈이 들고, 바깥에서 <b>밀어 넣게</b> 한다.
 *
 * <p>반대로 RUM이 `useGlobalStomp`를 읽으러 가면
 * `http.ts → useRum → useGlobalStomp → http.ts` 순환 참조가 생긴다. 런타임 호출이라
 * 당장은 돌더라도 모듈 초기화 순서에 따라 조용히 `undefined`가 되는 종류의 버그라
 * 애초에 방향을 한쪽으로 고정한다.</p>
 */
export function recordDisconnect(): void {
  disconnects += 1
}

/** 전송 — 실패는 조용히 버린다. RUM 때문에 앱이 느려지거나 죽으면 안 된다. */
function send(params: Record<string, string | number>): void {
  try {
    const qs = new URLSearchParams({ v: '1', rid })
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
    // keepalive: 탭을 닫는 중에도 전송이 보장된다. 응답은 보지 않는다(204).
    void fetch(`${RUM_ENDPOINT}?${qs.toString()}`, {
      method: 'GET',
      keepalive: true,
      cache: 'no-store',
    }).catch(() => {})
  } catch {
    /* 여기서 던지면 호출부가 깨진다 — 관측 실패는 앱에 영향을 주지 않아야 한다 */
  }
}

/** MediaPipe 자산 통계. Resource Timing이 이미 다 갖고 있어 모델 코드를 건드릴 필요가 없다. */
function mediapipeStats() {
  const entries = performance
    .getEntriesByType('resource')
    .filter((e): e is PerformanceResourceTiming => e.name.includes('/mediapipe/'))
  if (entries.length === 0) return { mdln: 0, mdlkb: 0, mdlms: 0, simd: -1 }
  return {
    mdln: entries.length,
    // transferSize가 0이면 캐시 적중(-161 Cache Storage)이다 — 재방문자의 실제 전송량이 0으로 잡힌다
    mdlkb: Math.round(entries.reduce((sum, e) => sum + (e.transferSize || 0), 0) / 1024),
    mdlms: Math.round(
      Math.max(...entries.map((e) => e.responseEnd)) - Math.min(...entries.map((e) => e.startTime)),
    ),
    // nosimd 빌드가 받아졌다면 이 브라우저는 SIMD 미지원 — 추론이 크게 느려진다
    simd: entries.some((e) => e.name.includes('nosimd')) ? 0 : 1,
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return Math.round(sorted[idx] ?? 0)
}

function sendBoot(): void {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  send({
    t: 'boot',
    // loadEventEnd가 0이면 아직 load 전이다 — 그 경우 0으로 두고 분석에서 제외한다
    load: nav ? Math.max(0, Math.round(nav.loadEventEnd - nav.startTime)) : 0,
    ttfb: nav ? Math.max(0, Math.round(nav.responseStart - nav.startTime)) : 0,
    mob: matchMedia('(pointer: coarse)').matches ? 1 : 0,
    w: window.innerWidth,
    dpr: Math.round(window.devicePixelRatio * 10) / 10,
    ...mediapipeStats(),
  })
}

function sendBeat(): void {
  const samples = apiTimings
  apiTimings = []
  send({
    t: 'beat',
    // 누적 끊김 횟수. 재연결 스톰이 실제로 일어났는지는 이 값의 분포로 판정한다
    rc: disconnects,
    n: samples.length,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    scr: location.pathname,
    ...mediapipeStats(),
  })
}

/**
 * 에러 1건 보고. 상한·중복제거를 통과한 것만 나간다.
 *
 * <p>여기서 던지면 에러 핸들러가 또 에러를 내는 무한루프가 된다 — 전부 삼킨다.</p>
 */
function sendError(message: string, where: string): void {
  try {
    if (!started || errCount >= ERR_MAX_PER_SESSION) return
    const key = (message || 'unknown').slice(0, 120)
    if (seenErrors.has(key)) return // 같은 에러의 반복은 한 번만 — 루프로 터지는 게 보통이다
    seenErrors.add(key)
    errCount += 1
    send({ t: 'err', m: key, at: where.slice(0, 80), scr: location.pathname })
  } catch {
    /* 에러 보고가 에러를 내면 안 된다 */
  }
}

function onWindowError(e: ErrorEvent): void {
  // 리소스 로드 실패(script·img·wasm)는 message가 비어 있고 target이 엘리먼트다.
  // MediaPipe 다운로드 실패가 정확히 여기로 오므로 버리지 않고 종류를 구분해 남긴다.
  if (!e.message && e.target && e.target !== window) {
    const el = e.target as Partial<HTMLImageElement & HTMLScriptElement & HTMLLinkElement> & {
      tagName?: string
    }
    sendError(`resource: ${el.src || el.href || el.tagName || '?'}`, 'res')
    return
  }
  sendError(e.message, e.filename ? `${e.filename}:${e.lineno}` : '')
}

function onRejection(e: PromiseRejectionEvent): void {
  const reason: unknown = e.reason
  const message =
    typeof reason === 'string'
      ? reason
      : ((reason as { message?: string } | null)?.message ?? String(reason))
  sendError(message, 'promise')
}

/** API 체감 소요시간을 모은다(http.ts에서 호출). 전송은 60초 배치에서 한 번에 한다. */
export function recordApiTiming(ms: number): void {
  if (!started) return
  if (apiTimings.length >= API_SAMPLE_MAX) apiTimings.shift()
  apiTimings.push(ms)
}

/** App.vue에서 <b>한 번만</b> 호출한다. */
export function startRum(): void {
  if (started) return
  started = true
  try {
    rid = Math.random().toString(36).slice(2, 8)
    setTimeout(sendBoot, BOOT_DELAY_MS)
    beatTimer = setInterval(sendBeat, BEAT_INTERVAL_MS)
    // addEventListener 로 붙인다 — window.onerror 에 '할당'하면 기존 핸들러를 덮어쓴다.
    // capture 단계여야 리소스 로드 실패(버블링하지 않는다)까지 잡힌다.
    window.addEventListener('error', onWindowError, true)
    window.addEventListener('unhandledrejection', onRejection)
  } catch {
    started = false
  }
}

export function stopRum(): void {
  clearInterval(beatTimer)
  beatTimer = undefined
  window.removeEventListener('error', onWindowError, true)
  window.removeEventListener('unhandledrejection', onRejection)
  started = false
}
