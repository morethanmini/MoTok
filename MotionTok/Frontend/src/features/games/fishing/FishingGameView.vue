<script setup lang="ts">
/**
 * 낚시 게임 (/dev/fishing-game) — 게임⑤ 세 동작을 이어붙인 실제 루프 (S15P11A706-10).
 *
 * 랩(/dev/fishing-lab)은 판정 하나하나를 재는 도구이고, 여기는 **재미를 판단하는 화면**이다.
 * 캐스팅을 따로 재봤을 때 "맛이 없다"고 나온 이유가 판정이 아니라 목적(조준→착수→대기→입질)이
 * 없어서였다(2026-07-29 실기 지적) — 그 사슬을 붙인다.
 *
 * 페이즈별로 활성 판정이 하나뿐이라 서로 오발하지 않는다:
 *   IDLE  → 캐스팅(cast.ts)   — 양손 중점
 *   BITE  → 훅킹(hook.ts)     — 양손 중점
 *   FIGHT → 펌핑(pump.ts)     — 오른손 손목 y → 힘겨루기(fight.ts)
 *
 * 신호가 두 종류인 이유는 자세가 다르기 때문이다. 던지고 챔질할 때는 양손으로 대를 쥐고 있고,
 * 물고기가 걸린 뒤에는 한 손으로 대를 잡고 다른 손으로 릴을 돌린다.
 *
 * 모든 문턱은 어깨 너비 배수다(`normalize.ts`) — px 문턱은 카메라 거리에 흔들린다.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  preloadPoseLandmarker,
  usePoseLandmarker,
  type PoseLandmarkerResult,
} from '@/composables/usePoseLandmarker'
import { createCast, DEFAULT_CAST } from './cast'
import { createHook, DEFAULT_HOOK } from './hook'
import { createPump, DEFAULT_PUMP } from './pump'
import { createLoop, DEFAULT_LOOP, type LoopState } from './loop'
import { createNormalizer, SHOULDER, VIS_MIN, WRIST } from './normalize'

const W = DEFAULT_LOOP.width
const H = DEFAULT_LOOP.height
const WATER_Y = DEFAULT_LOOP.waterY

/**
 * 크랭크 손 — 고정이다.
 *
 * "움직임이 큰 쪽을 자동 선택"은 실측에서 3/3 실패했다(2026-07-30): 대를 잡은 손도 함께
 * 움직이고(197~212px), 왼손으로 돌린 세션에서는 반대 손이 오히려 더 움직였다. 게다가
 * 오른손 크랭크가 지속 속도 1.24~1.49/s인데 왼손은 0.55~0.88/s로 절반 이하였다.
 */
const crankSide = ref<'right' | 'left'>('right')
const pose = usePoseLandmarker()
const videoRef = ref<HTMLVideoElement>()
const canvasRef = ref<HTMLCanvasElement>()
const camError = ref<string | null>(null)
const loadProgress = ref(0)

// 문턱은 전부 실측으로 확정한 값이다(2026-07-30) — 화면에서 덮어쓸 이유가 없다
const castCfg = reactive({ ...DEFAULT_CAST })
const hookCfg = reactive({ ...DEFAULT_HOOK })
const pumpCfg = reactive({ ...DEFAULT_PUMP })
const cast = createCast(castCfg)
const hook = createHook(hookCfg)
const pump = createPump(pumpCfg)
const loop = createLoop(DEFAULT_LOOP, 1)
/** 어깨 너비 런닝 중앙값 — 모든 문턱의 분모 */
const norm = createNormalizer()

/** 렌더·표시용 스냅샷 — tick 후 매 프레임 갱신 */
const st = ref<LoopState>(loop.state())
/** 조준 상태 — IDLE에서 조준선에 쓴다. 조준은 좌우만(거리 제어 없음) */
const aim = reactive({ locked: false, x: 0 })
const reelRate = ref(0)
/**
 * 지금 판정에 쓰이는 점의 화면 좌표 — 캠 오버레이 마커.
 * IDLE·BITE는 양손 중점, FIGHTING은 크랭크 손 손목이다.
 */
let marker: { x: number; y: number } | null = null
/** 물보라·이펙트 */
let splashes: { x: number; y: number; r: number; life: number }[] = []
/** 마지막 페이즈 — 전환 시점에 판정기를 리셋하기 위한 비교값 */
let prevPhase = st.value.phase

const hud = computed(() => {
  const s = st.value
  switch (s.phase) {
    case 'idle':
      return aim.locked
        ? '조준 중 — 그대로 앞으로 던지세요'
        : '양손으로 낚싯대를 쥐고 뒤로 젖히세요'
    case 'casting':
      return '찌가 날아갑니다…'
    case 'waiting':
      return s.active?.interest === 'curious'
        ? '물고기가 찌를 봤어요…'
        : s.active
          ? '물고기가 다가옵니다!'
          : '입질을 기다립니다…'
    case 'bite':
      return '입질! 손을 위로 번쩍!'
    case 'fighting':
      return s.grace ? '걸렸다! 감으세요' : s.reeling ? '감기고 있다!' : 'DANGER — 더 빨리!'
    case 'result':
      return s.last?.outcome === 'caught'
        ? `${s.last.name} 낚았다! +${s.last.score}`
        : s.last?.outcome === 'missed'
          ? '챔질 실패… 놓쳤다'
          : `${s.last?.name ?? ''} 도망갔다…`
  }
})

let stream: MediaStream | null = null
let rafId = 0
let lastT = 0

/* ────────────────────────── 실기 로그 ──────────────────────────
 *
 * 문턱을 랩에서 확정했어도 **게임 루프에 붙인 뒤가 다르다** — 페이즈 전환, 판정기 리셋,
 * 실제 자세가 섞이기 때문이다. 그래서 판정에 쓰인 숫자를 그대로 남긴다.
 *
 * 특히 두 종류를 놓치지 않는 게 목적이다:
 *  ① **발사되지 않은 던짐** — 낙하가 문턱에 얼마나 못 미쳤는지. "안 던져진다"의 원인은
 *     이것 말고는 알 방법이 없다.
 *  ② **챔질 실패 시 관측된 최대값** — 훅킹 문턱은 미실측이라, 실패한 시도의 상향 속도와
 *     상승 거리를 봐야 문턱을 어느 쪽으로 옮길지 정할 수 있다.
 */
type LogTag = 'cast' | 'void' | 'aim' | 'land' | 'bite' | 'hook' | 'fight' | 'sys'
interface LogEntry {
  sec: string
  tag: LogTag
  text: string
}
const LOG_MAX = 300
const logs = ref<LogEntry[]>([])
let t0 = performance.now()

function log(tag: LogTag, text: string) {
  const sec = ((performance.now() - t0) / 1000).toFixed(1)
  // 최신이 위 — 테스트 중에는 방금 한 동작을 봐야 한다
  logs.value = [{ sec, tag, text }, ...logs.value].slice(0, LOG_MAX)
}

const stats = reactive({
  /** 발사된 파워들 */
  powers: [] as number[],
  /** 스윙은 했지만 낙하 부족으로 무효가 된 횟수 */
  voids: 0,
  /** 조준했다가 던지지 않고 내린 횟수 */
  cancels: 0,
  hookTry: 0,
  hookOk: 0,
  poseFrames: 0,
  /** 양손(또는 크랭크 손)을 놓친 프레임 */
  lostFrames: 0,
  swMin: 0,
  swMax: 0,
})
/** 힘겨루기 결과 — 어종표 재보정의 입력이다 */
const results: {
  name: string
  outcome: string
  sec: number
  req: number
  maxRate: number
  sustained: number
}[] = []

/** 캐스팅 판정 추적 — 무효 던짐을 잡기 위해 직전 페이즈와 마지막 낙하를 들고 있는다 */
let prevCastPhase: 'idle' | 'back' | 'forward' = 'idle'
let lastDropSw = 0
let lastRiseSw = 0
/** 마지막 발사 파워 — 착수 y와 함께 찍어 거리 매핑을 확인한다 */
let lastPower = 0
/** BITE 동안 관측한 최대 상향 속도·상승 거리 */
const hookPeak = { vel: 0, rise: 0 }
/**
 * 힘겨루기 진행 중 누적.
 *
 * `firstRateT`는 rate가 처음 0을 벗어난 시각이다 — **pump 워밍업 + 사람 반응 시간**이
 * 여기서 직접 측정된다. 이 값이 유예(2초)를 넘으면 손쓸 수 없이 도망가는 구간이 있다는 뜻이고,
 * 2026-07-30 실기에서 멸치 3마리를 그렇게 잃었다(`관측최대=0.00`).
 */
const fightRun = { startT: 0, name: '', req: 0, maxRate: 0, firstRateT: 0 }

function clearLog() {
  logs.value = []
  stats.powers = []
  Object.assign(stats, {
    voids: 0,
    cancels: 0,
    hookTry: 0,
    hookOk: 0,
    poseFrames: 0,
    lostFrames: 0,
    swMin: 0,
    swMax: 0,
  })
  results.length = 0
  t0 = performance.now()
  log('sys', '로그 초기화')
}

const n2 = (v: number) => v.toFixed(2)

function logText(): string {
  const p = stats.powers
  const lostPct = stats.poseFrames
    ? Math.round((stats.lostFrames / stats.poseFrames) * 100)
    : 0
  const head = [
    `[낚시게임 실기 로그] ${((performance.now() - t0) / 1000).toFixed(0)}초 · 크랭크손=${crankSide.value === 'right' ? '오른손' : '왼손'}`,
    `어깨너비: 중앙값=${Math.round(norm.sw())}px (관측 ${Math.round(stats.swMin)}~${Math.round(stats.swMax)}) · 랜드마크 손실=${lostPct}% (${stats.lostFrames}/${stats.poseFrames}f)`,
    `던짐: ${p.length}회 파워=[${p.map((v) => n2(v)).join(' ')}]${p.length ? ` 최소=${n2(Math.min(...p))} 최대=${n2(Math.max(...p))}` : ''}`,
    `무효 던짐(낙하 부족)=${stats.voids}회 · 조준 취소=${stats.cancels}회`,
    `챔질: ${stats.hookOk}/${stats.hookTry} 성공`,
    `힘겨루기: ${results.length}건`,
    ...results.map(
      (r) =>
        `  ${r.name} ${r.outcome} ${r.sec.toFixed(1)}s 요구=${n2(r.req)} 관측최대=${n2(r.maxRate)} 지속=${n2(r.sustained)}`,
    ),
    `설정: 낙하 ${DEFAULT_CAST.dropMinSw}~${DEFAULT_CAST.dropFullSw} 백스윙게이트=${DEFAULT_CAST.riseGateSw} 정착=${DEFAULT_CAST.settleMs}ms 최소백스윙=${DEFAULT_CAST.minBackMs}ms 훅킹 ${DEFAULT_HOOK.upVelSw}/s·${DEFAULT_HOOK.minRiseSw} 릴진폭=${DEFAULT_PUMP.minAmpSw}`,
    '',
    '── 이벤트 (최신순) ──',
  ]
  return [...head, ...logs.value.map((e) => `${e.sec}s [${e.tag}] ${e.text}`)].join('\n')
}

const copied = ref(false)
const showRaw = ref(false)
const rawText = ref('')
async function copyLog() {
  try {
    await navigator.clipboard.writeText(logText())
  } catch {
    rawText.value = logText()
    showRaw.value = true
    return
  }
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}
function toggleRaw() {
  rawText.value = logText()
  showRaw.value = !showRaw.value
}

function onPose(result: PoseLandmarkerResult) {
  const lm = result.landmarks?.[0]
  const now = performance.now()
  const phase = loop.state().phase
  stats.poseFrames++

  // ── 분모 먼저 ── 어깨를 못 본 프레임에는 갱신하지 않고 직전 중앙값을 그대로 쓴다
  const sl = lm?.[SHOULDER.left]
  const sr = lm?.[SHOULDER.right]
  if (sl && sr && (sl.visibility ?? 0) >= VIS_MIN && (sr.visibility ?? 0) >= VIS_MIN) {
    const width = Math.hypot((sr.x - sl.x) * W, (sr.y - sl.y) * H)
    norm.push(width)
    stats.swMin = stats.swMin === 0 ? width : Math.min(stats.swMin, width)
    stats.swMax = Math.max(stats.swMax, width)
  }
  const sw = norm.ready() ? norm.sw() : 0

  const wl = lm?.[WRIST.left]
  const wr = lm?.[WRIST.right]
  const leftOk = !!wl && (wl.visibility ?? 0) >= VIS_MIN
  const rightOk = !!wr && (wr.visibility ?? 0) >= VIS_MIN

  if (phase === 'fighting') {
    /*
     * 릴 감기 — **크랭크 손 손목 y**의 왕복.
     *
     * 한 손은 대를 잡고 다른 손으로 원을 그리는 자세다. 화면에 찍히는 궤도는 세로로 긴
     * 타원이라(오른손 종횡비 실측 0.21~0.23) x는 y의 1/5뿐이고, 섞으면 신호 대 잡음만
     * 나빠진다. 그래서 y 하나만 본다.
     *
     * 이전에 이 방식을 버렸던 이유는 진폭 문턱 90px을 못 넘어서였는데, 실측하니 진폭이
     * 어깨너비 ×1.68~1.74(=278~361px)로 문턱을 3배 넘었다 — 신호가 아니라 문턱이 틀렸다.
     */
    const cw = crankSide.value === 'right' ? wr : wl
    const ok = crankSide.value === 'right' ? rightOk : leftOk
    if (cw && ok) {
      const y = cw.y * H
      marker = { x: (1 - cw.x) * W, y }
      reelRate.value = pump.feed(y, sw, now).rate
      if (reelRate.value > fightRun.maxRate) fightRun.maxRate = reelRate.value
      if (reelRate.value > 0 && fightRun.firstRateT === 0) fightRun.firstRateT = now
    } else {
      // 손을 놓치면 감기를 멈춘다. feed를 건너뛰면 마지막 rate가 남아 손을 내려도 게이지가 찬다
      marker = null
      reelRate.value = 0
      stats.lostFrames++
    }
    return
  }

  /*
   * 캐스팅·훅킹 — **양손 손목의 중점**.
   *
   * 양손으로 대를 쥐고 던지는 동작이라 두 손이 함께 움직인다. 중점을 쓰면 노이즈가 단일
   * 손목의 절반이고, 한 손이라도 놓치면 판정이 멈춰 "양손으로 쥐었는지"가 자동 검증된다.
   */
  if (!wl || !wr || !leftOk || !rightOk) {
    marker = null
    stats.lostFrames++
    return
  }
  const midX = ((1 - wl.x) * W + (1 - wr.x) * W) / 2
  const midY = (wl.y * H + wr.y * H) / 2
  marker = { x: midX, y: midY }

  // 페이즈별로 하나만 — 서로 오발하지 않는다
  if (phase === 'idle') {
    const c = cast.feed(midX, midY, sw, now)
    aim.locked = c.phase === 'back'
    if (c.aimX !== null) aim.x = c.aimX
    if (c.dropSw > 0) lastDropSw = c.dropSw
    if (c.riseSw > 0) lastRiseSw = c.riseSw

    if (c.phase !== prevCastPhase) {
      if (c.phase === 'back') log('aim', `조준 시작 (상승 ×${n2(c.riseSw)})`)
      if (prevCastPhase === 'back' && c.phase === 'idle')
        // 스윙 없이 back → idle = 천천히 내려서 취소된 것
        { stats.cancels++; log('aim', '조준 취소 — 던지지 않고 내렸다') }
      if (c.phase === 'forward') log('cast', `스윙 시작 (상승 ×${n2(c.riseSw)})`)
      prevCastPhase = c.phase
    }

    // 조준은 발사 시점에 판정기가 확정한 값을 쓴다(내려꽂는 동안의 흔들림 배제)
    if (c.fired !== null) {
      lastPower = c.fired
      stats.powers.push(c.fired)
      log(
        'cast',
        `던짐 파워=${n2(c.fired)} 낙하=×${n2(lastDropSw)} 상승=×${n2(lastRiseSw)} 조준x=${Math.round(c.firedAimX)} sw=${Math.round(sw)}px`,
      )
      loop.cast(c.firedAimX, c.fired)
      lastDropSw = 0
    } else if (prevCastPhase === 'idle' && lastDropSw > 0) {
      /*
       * 스윙은 있었는데 발사가 없었다 = 낙하가 문턱 미달. "안 던져진다"의 유일한 단서다.
       * forward에서 idle로 떨어진 다음 프레임에 잡힌다(위에서 prevCastPhase가 갱신된 뒤).
       */
      stats.voids++
      log(
        'void',
        `무효 — 낙하 ×${n2(lastDropSw)} < 문턱 ×${DEFAULT_CAST.dropMinSw} (상승 ×${n2(lastRiseSw)})`,
      )
      lastDropSw = 0
    }
  } else if (phase === 'bite') {
    const h = hook.feed(midY, sw, now)
    if (h.upVelSw > hookPeak.vel) hookPeak.vel = h.upVelSw
    if (h.riseSw > hookPeak.rise) hookPeak.rise = h.riseSw
    if (h.fired) {
      log('hook', `챔질 성공 — 상향 ×${n2(h.upVelSw)}/s 상승 ×${n2(h.riseSw)}`)
      loop.hook()
    }
  }
}

function spawnSplash(x: number, y: number) {
  splashes.push({ x, y, r: 6, life: 0.6 })
}

function frame(now: number) {
  rafId = requestAnimationFrame(frame)
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0
  lastT = now

  if (dt > 0) {
    loop.tick(dt, st.value.phase === 'fighting' ? reelRate.value : 0)
    const s = loop.state()

    // 페이즈 전환 처리 — 판정기를 초기화해 이전 동작이 새 페이즈로 새지 않게 한다
    if (s.phase !== prevPhase) {
      if (s.phase === 'waiting') {
        spawnSplash(s.bobber.x, s.bobber.y)
        // 착수 y로 거리 매핑을 확인한다 — 위(수평선)일수록 멀다
        const depth = (H - s.bobber.y) / (H - DEFAULT_LOOP.waterY)
        log(
          'land',
          `착수 y=${Math.round(s.bobber.y)} (수면까지 ${(depth * 100).toFixed(0)}%) ← 파워 ${n2(lastPower)}`,
        )
      }
      if (s.phase === 'bite') {
        hook.reset()
        hookPeak.vel = 0
        hookPeak.rise = 0
        stats.hookTry++
        log('bite', `입질! ${s.active?.spec.name ?? '?'} — 챔질 창 ${DEFAULT_LOOP.biteWindowSec}s`)
      }
      if (s.phase === 'fighting') {
        pump.reset()
        stats.hookOk++
        fightRun.startT = now
        fightRun.name = s.active?.spec.name ?? '?'
        fightRun.req = s.active?.spec.requiredRate ?? 0
        fightRun.maxRate = 0
        fightRun.firstRateT = 0
        log('fight', `힘겨루기 시작 ${fightRun.name} 요구=${n2(fightRun.req)}/s`)
      }
      if (s.phase === 'idle') {
        cast.reset()
        aim.locked = false
        prevCastPhase = 'idle'
        lastDropSw = 0
      }
      if (s.phase === 'result') {
        if (prevPhase === 'bite') {
          // 챔질 실패 — 관측 최대값이 문턱 조정의 유일한 근거다
          log(
            'hook',
            `챔질 실패 — 관측 최대 상향 ×${n2(hookPeak.vel)}/s (문턱 ${DEFAULT_HOOK.upVelSw}) 상승 ×${n2(hookPeak.rise)} (문턱 ${DEFAULT_HOOK.minRiseSw})`,
          )
        } else if (prevPhase === 'fighting') {
          const d = pump.debug()
          const span = (d.lastTick - d.firstTick) / 1000
          const sustained = d.halves >= 3 && span > 0 ? (d.halves - 1) / 2 / span : 0
          const sec = (now - fightRun.startT) / 1000
          results.push({
            name: fightRun.name,
            outcome: s.last?.outcome ?? '?',
            sec,
            req: fightRun.req,
            maxRate: fightRun.maxRate,
            sustained,
          })
          log(
            'fight',
            `${fightRun.name} ${s.last?.outcome} ${sec.toFixed(1)}s 요구=${n2(fightRun.req)} 관측최대=${n2(fightRun.maxRate)} 지속=${n2(sustained)}`,
          )
        }
        if (s.last?.outcome === 'caught') spawnSplash(s.bobber.x, s.bobber.y)
      }
      prevPhase = s.phase
    }
    st.value = s

    for (const p of splashes) {
      p.life -= dt
      p.r += dt * 90
    }
    splashes = splashes.filter((p) => p.life > 0)
  }

  draw()
}

function draw() {
  const cv = canvasRef.value
  const video = videoRef.value
  const ctx = cv?.getContext('2d')
  if (!cv || !ctx || !video) return
  const s = st.value

  // 하늘·바다
  const sky = ctx.createLinearGradient(0, 0, 0, WATER_Y)
  sky.addColorStop(0, '#1c2a5e')
  sky.addColorStop(1, '#2a3f8c')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, WATER_Y)
  const sea = ctx.createLinearGradient(0, WATER_Y, 0, H)
  sea.addColorStop(0, '#0f2f66')
  sea.addColorStop(1, '#081735')
  ctx.fillStyle = sea
  ctx.fillRect(0, WATER_Y, W, H - WATER_Y)

  // 캠 — 물 위에 반투명으로 겹친다(기획 §게임 화면 구성: 내 캠은 반투명)
  if (video.readyState >= 2) {
    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, W, H)
    ctx.restore()
  }

  // 수면선
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, WATER_Y)
  ctx.lineTo(W, WATER_Y)
  ctx.stroke()

  for (const f of s.fishes) drawFish(ctx, f, s)
  drawSplashes(ctx)
  if (s.bobber.visible) drawBobber(ctx, s)
  if (s.phase === 'idle' && aim.locked) drawAim(ctx)
  if (marker) drawSignalMarker(ctx, s)
  drawGauges(ctx, s)
}

function drawFish(ctx: CanvasRenderingContext2D, f: LoopState['fishes'][number], s: LoopState) {
  const r = 8 + (1 - f.spec.requiredRate) * 14
  const isActive = f === s.active
  ctx.save()
  ctx.translate(f.x, f.y)
  if (f.dir < 0) ctx.scale(-1, 1)
  ctx.fillStyle = isActive ? '#FFD23F' : '#3ddcff'
  ctx.globalAlpha = f.interest === 'none' ? 0.75 : 1
  ctx.beginPath()
  ctx.moveTo(-r * 0.9, 0)
  ctx.lineTo(-r * 1.6, -r * 0.55)
  ctx.lineTo(-r * 1.6, r * 0.55)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#0d1020'
  ctx.beginPath()
  ctx.arc(r * 0.5, -r * 0.12, r * 0.11, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 관심 단계 표시 — 대기의 긴장감을 눈에 보이게 한다
  if (f.interest === 'curious') drawMark(ctx, f.x, f.y - r - 12, '?', '#FFD23F')
  else if (f.interest === 'approaching' && s.phase === 'waiting')
    drawMark(ctx, f.x, f.y - r - 12, '!', '#FF9F43')
  else if (isActive && s.phase === 'bite') drawMark(ctx, f.x, f.y - r - 14, '!!', '#FF5D73')
}

function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.save()
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.fillText(text, x, y)
  ctx.restore()
}

function drawBobber(ctx: CanvasRenderingContext2D, s: LoopState) {
  const shake = s.phase === 'bite' ? Math.sin(performance.now() * 0.03) * 4 : 0
  const bx = s.bobber.x
  const by = s.bobber.y + shake
  // 낚싯줄 — 화면 아래 중앙(앵글러)에서 찌까지
  ctx.strokeStyle = 'rgba(244,240,255,0.5)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(W / 2, H - 12)
  ctx.lineTo(bx, by)
  ctx.stroke()
  ctx.fillStyle = '#FF5D73'
  ctx.beginPath()
  ctx.arc(bx, by - 4, 7, Math.PI, 0)
  ctx.fill()
  ctx.fillStyle = '#F4F0FF'
  ctx.beginPath()
  ctx.arc(bx, by + 2, 7, 0, Math.PI)
  ctx.fill()
}

/**
 * 조준 미리보기 — 좌우 조준선과, 착수 가능 범위(가까이~멀리)를 함께 보여준다.
 * 거리는 스윙 최고 속도로 정해지므로 미리보기 게이지가 없다(cast.ts 주석 ③) — 대신 "이 선
 * 위 어딘가에 떨어진다"는 범위를 보여줘서 세게/약하게 던지는 감을 잡게 한다.
 */
function drawAim(ctx: CanvasRenderingContext2D) {
  const nearY = H - DEFAULT_LOOP.landNearMarginPx
  const farY = WATER_Y + DEFAULT_LOOP.landFarMarginPx
  ctx.save()
  // 착수 가능 범위 — 세로 막대
  ctx.strokeStyle = 'rgba(198,255,94,0.35)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(aim.x, farY)
  ctx.lineTo(aim.x, nearY)
  ctx.stroke()
  // 던지는 라인
  ctx.strokeStyle = '#C6FF5E'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])
  ctx.beginPath()
  ctx.moveTo(W / 2, H - 12)
  ctx.lineTo(aim.x, nearY)
  ctx.stroke()
  ctx.setLineDash([])
  // 양 끝 표시 — 위가 멀리, 아래가 가까이
  const pulse = 5 + Math.sin(performance.now() / 160) * 2
  for (const y of [farY, nearY]) {
    ctx.beginPath()
    ctx.arc(aim.x, y, pulse, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(198,255,94,0.8)'
  ctx.font = '10px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('세게', aim.x, farY - 10)
  ctx.fillText('약하게', aim.x, nearY + 18)
  ctx.restore()
}

function drawSplashes(ctx: CanvasRenderingContext2D) {
  ctx.save()
  ctx.strokeStyle = 'rgba(191,233,255,0.7)'
  ctx.lineWidth = 3
  for (const p of splashes) {
    ctx.globalAlpha = Math.max(0, p.life / 0.6)
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawSignalMarker(ctx: CanvasRenderingContext2D, s: LoopState) {
  if (!marker) return
  const color =
    s.phase === 'bite' ? '#FF5D73' : s.phase === 'fighting' && s.reeling ? '#C6FF5E' : '#3ddcff'
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = 14
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(marker.x, marker.y, 8, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawGauges(ctx: CanvasRenderingContext2D, s: LoopState) {
  if (s.phase === 'fighting') {
    const w = W - 40
    ctx.fillStyle = 'rgba(11,19,48,0.7)'
    ctx.fillRect(20, H - 34, w, 16)
    ctx.fillStyle = s.reeling ? '#C6FF5E' : '#FF5D73'
    ctx.fillRect(20, H - 34, w * s.progress, 16)
    ctx.strokeStyle = 'rgba(244,240,255,0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(20, H - 34, w, 16)
  }
  if (s.phase === 'bite') {
    const w = W - 40
    const p = s.biteLeftSec / DEFAULT_LOOP.biteWindowSec
    ctx.fillStyle = 'rgba(11,19,48,0.7)'
    ctx.fillRect(20, H - 34, w, 10)
    ctx.fillStyle = '#FFD23F'
    ctx.fillRect(20, H - 34, w * p, 10)
  }
}

onMounted(async () => {
  lastT = 0
  frame(performance.now())
  preloadPoseLandmarker((f) => (loadProgress.value = f))
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H } })
  } catch {
    camError.value = '카메라를 열 수 없어요 — 브라우저 권한을 확인해 주세요'
    return
  }
  const video = videoRef.value!
  video.srcObject = stream
  await video.play().catch(() => {})
  await pose.start(video, onPose)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  pose.stop()
  stream?.getTracks().forEach((t) => t.stop())
})
</script>

<template>
  <div class="game">
    <header>
      <h1>낚시 <small>게임⑤ · S15P11A706-10</small></h1>
      <span class="score">SCORE {{ st.score }}</span>
      <button
        type="button"
        title="릴을 돌리는 손 — 던지기·챔질은 양손이라 영향 없다"
        @click="crankSide = crankSide === 'right' ? 'left' : 'right'"
      >
        릴 {{ crankSide === 'right' ? '오른손' : '왼손' }}
      </button>
      <button type="button" @click="loop.reset()">다시</button>
      <div class="logbar">
        <button type="button" class="copy" @click="copyLog">
          {{ copied ? '복사됨 ✓' : '로그 복사' }}
        </button>
        <button type="button" @click="toggleRaw">원문</button>
        <button type="button" @click="clearLog">로그 초기화</button>
      </div>
    </header>

    <p class="err" v-if="camError || pose.error.value">{{ camError || pose.error.value }}</p>
    <p class="err" v-else-if="pose.isLoading.value">
      포즈 모델 로딩 중… {{ Math.round(loadProgress * 100) }}%
    </p>

    <div class="stage">
      <canvas ref="canvasRef" :width="W" :height="H" />
      <video ref="videoRef" playsinline muted class="hidden-video" />
      <div class="hud" :class="st.phase">{{ hud }}</div>
    </div>

    <ol class="guide">
      <li>
        <b>던지기</b> — <b>양손으로 낚싯대를 쥐고</b> 뒤로 젖히면 조준선이 뜬다. 손을
        <b>좌우로 옮겨 조준</b>하고 그대로 앞으로 던진다. <b>팔로스루를 크게</b> 하면 멀리
        간다(멈추는 단계 없이 한 동작으로)
      </li>
      <li><b>기다리기</b> — 물고기가 <b>?</b> → <b>!</b> 로 다가온다</li>
      <li><b>챔질</b> — <b>!!</b> 가 뜨면 양손 그대로 <b>위로 번쩍</b></li>
      <li>
        <b>감기</b> — <b>한 손으로 대를 잡고</b> 오른손으로 원을 그리듯 릴을 돌린다. 멈추면
        도망간다
      </li>
    </ol>

    <div class="catches" v-if="st.caught.length">
      <span v-for="(c, i) in st.caught" :key="i" class="chip">{{ c.name }} +{{ c.score }}</span>
    </div>

    <textarea
      v-if="showRaw"
      class="rawbox"
      readonly
      rows="14"
      :value="rawText"
      @focus="(e) => (e.target as HTMLTextAreaElement).select()"
    />

    <section class="logpanel">
      <h2>
        판정 로그
        <small>
          던짐 {{ stats.powers.length }} · 무효 {{ stats.voids }} · 취소 {{ stats.cancels }} · 챔질
          {{ stats.hookOk }}/{{ stats.hookTry }} · sw {{ Math.round(norm.sw()) }}px
        </small>
      </h2>
      <p class="empty" v-if="!logs.length">
        아직 이벤트가 없다. 던지고 챔질하고 감으면 판정에 쓰인 숫자가 여기 쌓인다 —
        <b>무효 던짐</b>과 <b>챔질 실패 시 관측 최대값</b>이 문턱 조정의 근거다.
      </p>
      <ul v-else>
        <li v-for="(e, i) in logs" :key="i" :class="e.tag">
          <span class="t">{{ e.sec }}s</span>
          <span class="g">{{ e.tag }}</span>
          <span class="x">{{ e.text }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.game {
  min-height: 100vh;
  background: #0b1330;
  color: #f4f0ff;
  font-family: system-ui, sans-serif;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}
header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  width: min(640px, 100%);
}
.logbar {
  display: flex;
  gap: 6px;
  width: 100%;
}
button.copy {
  background: #c6ff5e;
  color: #101a12;
  border-color: #c6ff5e;
  font-weight: 700;
}
button.copy:hover {
  background: #d6ff8a;
}
h1 {
  font-size: 18px;
  margin: 0;
}
h1 small {
  font-size: 11px;
  color: #93a1c9;
  font-weight: 400;
  margin-left: 6px;
}
.score {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  font-weight: 700;
  color: #c6ff5e;
}
.rawbox {
  width: min(640px, 100%);
  background: #0d1128;
  color: #f4f0ff;
  border: 1px solid rgba(198, 255, 94, 0.4);
  border-radius: 10px;
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.55;
  resize: vertical;
}
.logpanel {
  width: min(640px, 100%);
  background: #101a3d;
  border: 1px solid rgba(244, 240, 255, 0.1);
  border-radius: 12px;
  padding: 10px 12px;
}
.logpanel h2 {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #93a1c9;
  margin: 0 0 8px;
}
.logpanel h2 small {
  text-transform: none;
  letter-spacing: 0;
  font-family: ui-monospace, monospace;
  color: #f4f0ff;
  margin-left: 8px;
}
.logpanel .empty {
  margin: 0;
  font-size: 11.5px;
  color: #93a1c9;
  line-height: 1.6;
}
.logpanel .empty b {
  color: #f4f0ff;
}
.logpanel ul {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow-y: auto;
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
}
.logpanel li {
  display: grid;
  grid-template-columns: 44px 42px 1fr;
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(244, 240, 255, 0.05);
}
.logpanel .t {
  color: #4d5f92;
  text-align: right;
}
.logpanel .g {
  color: #93a1c9;
}
/* 색은 "봐야 하는 것"에만 준다 — 무효 던짐과 챔질이 분석의 핵심이다 */
.logpanel li.cast .x {
  color: #c6ff5e;
}
.logpanel li.void .x {
  color: #ff5d73;
}
.logpanel li.hook .x {
  color: #ffd23f;
}
.logpanel li.fight .x {
  color: #3ddcff;
}
.logpanel li.aim .x,
.logpanel li.land .x,
.logpanel li.bite .x {
  color: #93a1c9;
}
button {
  background: #1c2a5e;
  color: #f4f0ff;
  border: 1px solid rgba(244, 240, 255, 0.14);
  border-radius: 8px;
  padding: 5px 11px;
  font-size: 12px;
  cursor: pointer;
}
.err {
  color: #ffd3da;
  font-size: 13px;
  margin: 0;
}
.stage {
  position: relative;
  border: 1px solid rgba(244, 240, 255, 0.12);
  border-radius: 12px;
  overflow: hidden;
}
canvas {
  display: block;
  width: min(640px, 100%);
  height: auto;
}
.hidden-video {
  position: absolute;
  width: 2px;
  height: 2px;
  opacity: 0;
  top: 0;
  left: 0;
}
.hud {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(11, 19, 48, 0.78);
  border: 1px solid rgba(244, 240, 255, 0.14);
  border-radius: 20px;
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.hud.bite {
  color: #ffd3da;
  border-color: rgba(255, 93, 115, 0.6);
  background: rgba(255, 59, 92, 0.28);
}
.hud.fighting {
  color: #dcf7b0;
  border-color: rgba(198, 255, 94, 0.5);
}
.guide {
  width: min(640px, 100%);
  font-size: 12.5px;
  color: #93a1c9;
  line-height: 1.7;
  margin: 0;
  padding-left: 1.2em;
}
.guide b {
  color: #f4f0ff;
}
.catches {
  width: min(640px, 100%);
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  background: #152049;
  border: 1px solid rgba(244, 240, 255, 0.12);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11.5px;
  font-family: ui-monospace, monospace;
}
</style>
