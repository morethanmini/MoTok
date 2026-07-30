<script setup lang="ts">
/**
 * 낚시 랩 (/dev/fishing-lab) — 재설계 실측 도구 (S15P11A706-10).
 *
 * 판정기를 다시 짜기 **전에** 숫자 3개를 얻는 것이 이 화면의 유일한 목적이다. 회전 판정 때
 * 실패한 순서(문턱을 먼저 정하고 나중에 실측)를 반복하지 않는다.
 *
 *   ① 어깨 너비(px) — 모든 문턱의 정규화 분모. 이 값이 흔들리면 정규화 자체가 성립하지 않으므로
 *      현재값이 아니라 **변동폭**이 판단 대상이다.
 *   ② 한 손 크랭크의 손목 y 진폭(px, 어깨너비 배수) — 릴 감기 문턱의 근거.
 *      이전 문턱 90px은 *양팔을 크게 흔드는* 동작 실측치(191~358px)에 맞춘 값이라 한 손
 *      크랭크에는 과했다. 실제 진폭과 **정지 노이즈 플로어** 사이에 문턱을 놓아야 한다.
 *   ③ 양손 중점의 백스윙 상승 거리와 포워드 스윙 최고 속도 — 캐스팅 거리 매핑의 근거.
 *      핵심 숫자는 절대값이 아니라 **강 ÷ 약 비율**이다. 1.2배면 거리 조절이 성립하지 않고,
 *      2배 이상이면 성립한다.
 *
 * ── 왜 판정기를 안 쓰고 랩에서 직접 재는가 ──
 * ②는 `pump.ts`를 재사용한다(슈미트 트리거는 스칼라 하나만 받는다). 단 진폭 문턱을 6px까지
 * 낮춰서 먹인다 — **지금 정하려는 값이 측정을 막으면 안 된다.**
 * ③은 `cast.ts`를 쓰지 않는다. 새 설계에서 없어지는 단계(어깨 위 유지 → 어깨 아래 발사)가
 * 판정기에 박혀 있어서, 그걸 통과해야 하는 측정은 새 동작을 재지 못한다. 기록 문턱만 아주
 * 낮게 두고 전부 남긴 뒤 숫자를 보고 판정 문턱을 정한다.
 *
 * ── 화면 구성 원칙 ──
 * 측정은 ①→②→③ 순서로 하나씩 한다. 그래서 화면도 한 번에 한 단계만 보여준다 — 세 단계를
 * 동시에 펼치면 숫자 30개가 같은 크기로 깔려서 "어느 게 답인지" 알 수 없다(2026-07-30 지적).
 * 각 단계는 **큰 숫자 하나 = 그 단계의 답**이고, 나머지는 `자세히` 안에 접어둔다.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  preloadPoseLandmarker,
  usePoseLandmarker,
  type PoseLandmarkerResult,
} from '@/composables/usePoseLandmarker'
import { createPump, DEFAULT_PUMP } from './pump'

/** MediaPipe Pose 랜드마크 인덱스 */
const WRIST = { left: 15, right: 16 } as const
const SHOULDER = { left: 11, right: 12 } as const
/** 이 값 미만이면 못 본 것으로 취급 */
const VIS_MIN = 0.5
/** 프레임 여유 가이드 — 가장자리에서 이만큼 안쪽이 안전 영역 */
const SAFE_INSET = 0.08

const W = 640
const H = 480

/** 크랭크 진폭을 재는 창(ms) — pump.ts의 windowMs와 같게 둬야 측정값이 판정값과 같다 */
const CRANK_WIN = 900
/** 속도 창(ms) — cast.ts와 같은 값 */
const VEL_WIN = 80
/** 캐스팅 상승 거리·최고점을 찾는 창(ms) */
const THROW_WIN = 1500
/**
 * 던짐 기록을 시작하는 하향 속도(px/s).
 * **판정 문턱이 아니라 기록 문턱이다** — 약하게 던진 것도 남아야 강·약 비율이 나온다.
 */
const THROW_START_VEL = 250
/** 최고 속도의 이 비율 아래로 떨어지면 스윙이 끝났다고 보고 기록을 닫는다 */
const THROW_END_RATIO = 0.4
/** 기록 후 재검출 금지(ms) — 손이 되돌아오는 반동을 두 번 세지 않게 */
const THROW_COOLDOWN = 400
/** 정지 기준선(노이즈 플로어) 측정 시간(ms) */
const FLOOR_MS = 2000
/** 크랭크 손 교체 히스테리시스 — 반대 손이 이 배수 이상 커야 바꾼다 */
const CRANK_SWITCH = 1.3
/** 화면에 남기는 중점 궤적 길이(프레임) */
const TRAIL_MAX = 45
/** ①의 판정을 내리기 위한 최소 관측 프레임 — 30fps에서 약 2초 */
const SW_MIN_FRAMES = 60

/** 지금 보고 있는 측정 단계 */
const step = ref<1 | 2 | 3>(1)

/* ────────────────────────── ① 어깨 너비 ────────────────────────── */

const sw = reactive({
  /** 현재 프레임의 어깨 너비(px) */
  now: 0,
  min: 0,
  max: 0,
  /** 평균 — 정규화 분모 후보 */
  avg: 0,
  /** 관측 프레임 수 */
  n: 0,
})
let swSum = 0

/**
 * 변동폭(%) = (최대 - 최소) ÷ 평균.
 *
 * 이게 크면 어깨 너비를 분모로 쓸 수 없다는 뜻이다 — 몸을 돌리면 어깨가 짧아 보이므로
 * 앉은 자세에서 얼마나 흔들리는지가 미지수다. 10% 안쪽이면 쓸 만하고, 30%를 넘으면
 * 매 프레임 값이 아니라 관측 최대값(런닝 맥스)을 분모로 써야 한다.
 */
const swVarPct = computed(() =>
  sw.avg > 0 && sw.max > sw.min ? Math.round(((sw.max - sw.min) / sw.avg) * 100) : 0,
)

interface Verdict {
  cls: 'ok' | 'warn' | 'bad' | 'wait'
  text: string
}

const v1 = computed<Verdict>(() => {
  if (sw.n < SW_MIN_FRAMES)
    return { cls: 'wait', text: `측정 중… 양손과 어깨가 보이게 앉아주세요 (${sw.n}/${SW_MIN_FRAMES}f)` }
  if (swVarPct.value <= 10)
    return { cls: 'ok', text: '합격 — 매 프레임 어깨너비를 분모로 쓸 수 있다' }
  if (swVarPct.value <= 30)
    return { cls: 'warn', text: '주의 — 분모를 관측 최대값(런닝 맥스)으로 써야 한다' }
  return { cls: 'bad', text: '탈락 — 어깨너비로는 정규화가 안 된다. 다른 분모를 찾아야 한다' }
})

/* ────────────────────────── ② 릴 크랭크 ────────────────────────── */

/**
 * 진폭 문턱을 6px까지 낮춰 먹인다 — 이 랩이 정하려는 값이 측정을 막으면 안 된다.
 * 화면 슬라이더로 올려가며 "어디서 active가 꺼지는지"를 보고 문턱을 고른다.
 *
 * `minAmpSw`는 판정기에서 어깨너비 배수지만, 랩은 어깨너비를 1로 넣어 먹이므로 여기서는
 * **px 문턱으로 동작한다**. 랩은 배수를 정하기 위해 raw px를 봐야 하는 자리다.
 */
const crankCfg = reactive({ ...DEFAULT_PUMP, minAmpSw: 6, windowMs: CRANK_WIN })
const crankPump = createPump(crankCfg)

/**
 * 크랭크 손 자동 선택 — 끄면 버튼으로 고른 손을 유지한다.
 *
 * 자동을 켠 채로 버튼을 누르면 다음 프레임에 곧바로 되돌아간다(움직이는 쪽이 항상 이긴다).
 * 그래서 버튼은 자동을 끈다 — 안 그러면 아무 일도 안 하는 컨트롤이 된다.
 */
const autoSide = ref(true)

const crank = reactive({
  /** 크랭크 손 — autoSide가 켜져 있으면 움직임이 큰 쪽을 자동 선택한다 */
  side: 'right' as 'right' | 'left',
  /** 크랭크 손 y 진폭(px) — ②의 답 */
  ampY: 0,
  /** 크랭크 손 x 진폭(px) — "x 범위가 크지 않다"를 숫자로 확인한다 */
  ampX: 0,
  /** 관측된 y 진폭 최대값 — 한 번이라도 낸 진폭이라 문턱 상한의 근거다 */
  ampYMax: 0,
  /** 대를 잡은 손(반대쪽) y 진폭(px) — 두 손이 구분되는지의 근거 */
  restAmpY: 0,
  /** 순간 왕복 속도(왕복/s) */
  rate: 0,
  /** 지속 왕복 속도(왕복/s) — 밸런스는 이 숫자로 정한다 */
  avgRate: 0,
  /** 지속 구간 길이(초) */
  sec: 0,
  revs: 0,
  /** 현재 문턱에서 감기로 인정되는지 */
  active: false,
  /** 정지 기준선(px) — 손을 멈춘 채 관측된 y 진폭 최대값 = 노이즈 플로어 */
  floor: 0,
})

/** 궤도 종횡비 = x 진폭 ÷ y 진폭. 1보다 작으면 세로로 긴 타원이다 */
const crankAspect = computed(() => (crank.ampY > 0 ? +(crank.ampX / crank.ampY).toFixed(2) : 0))
/** y 진폭을 어깨 너비 배수로 — 이 값이 새 문턱의 단위다 */
const crankAmpSw = computed(() => (sw.avg > 0 ? +(crank.ampYMax / sw.avg).toFixed(3) : 0))
/**
 * 문턱 후보 = 노이즈 플로어와 실측 진폭의 기하평균.
 * 두 값 사이 어디든 되지만, 로그 스케일 중간이 양쪽에서 가장 멀다.
 */
const crankSuggest = computed(() => {
  if (crank.floor <= 0 || crank.ampYMax <= crank.floor) return 0
  return Math.round(Math.sqrt(crank.floor * crank.ampYMax))
})
/** 두 손이 구분되는가 — 대 잡은 손이 크랭크 손의 절반 아래여야 자동 선택이 성립한다 */
const handsSeparated = computed(
  () => crank.ampYMax > 0 && crank.restAmpY < crank.ampY * 0.5,
)

const v2 = computed<Verdict>(() => {
  if (crank.floor <= 0)
    return { cls: 'wait', text: '먼저 정지 기준선을 재세요 — 아래 버튼 누르고 손 가만히 2초' }
  if (crank.ampYMax <= crank.floor)
    return { cls: 'wait', text: '크랭크 동작이 아직 안 잡혔어요 — 한 손으로 릴을 돌려주세요' }
  if (crankSuggest.value >= crank.floor * 1.5)
    return { cls: 'ok', text: `합격 — 노이즈 ${Math.round(crank.floor)}px와 실측 ${Math.round(crank.ampYMax)}px 사이에 여유가 있다` }
  return { cls: 'bad', text: '위험 — 노이즈와 실제 동작이 너무 가깝다. 더 크게 돌려야 판정된다' }
})

/** 정지 기준선 측정 진행 상태 */
const floorRunning = ref(false)
let floorUntil = 0

function startFloor() {
  crank.floor = 0
  floorUntil = performance.now() + FLOOR_MS
  floorRunning.value = true
}

/* ────────────────────────── ③ 캐스팅 (양손 중점) ────────────────────────── */

interface ThrowRec {
  n: number
  tag: '강' | '약'
  /** 백스윙 상승 거리(px) — 최저점에서 최고점까지 */
  rise: number
  /** 포워드 스윙 낙하 거리(px) */
  drop: number
  /** 포워드 스윙 최고 하향 속도(px/s) — 거리 매핑의 입력 */
  vel: number
  /** 같은 속도를 어깨너비/s로 — 카메라 거리에 무관한 값 */
  velSw: number
  /** 기록 중 한 손이라도 놓쳤으면 true. 평균에서 제외한다 */
  lost: boolean
}

const throwTag = ref<'강' | '약'>('강')
const throws = ref<ThrowRec[]>([])
const cast = reactive({
  /** 양손 중점(px) */
  midX: 0,
  midY: 0,
  /** 현재 하향 속도(px/s) — 양수 = 아래로 */
  vel: 0,
  /** 관측 창의 최고점(y 최솟값) / 최저점(y 최댓값) */
  topY: 0,
  restY: 0,
  /** 지금 던짐을 기록하는 중인지 */
  recording: false,
  /** 양손이 다 보이는지 */
  visible: false,
  /** 양손 중 하나라도 못 본 프레임 — 누적 */
  lost: 0,
})

/** 기록 중인 던짐의 누적값 */
let recVel = 0
let recRise = 0
let recTop = 0
let recLost = false
let cooldownUntil = 0
let throwSeq = 0
/** 마지막 던짐이 끝난 시각(ms) — 상승 거리를 재는 구간의 시작점 */
let lastThrowEndT = 0

function goodOf(tag: '강' | '약'): ThrowRec[] {
  return throws.value.filter((t) => t.tag === tag && !t.lost)
}
function avgOf(tag: '강' | '약', key: 'vel' | 'velSw' | 'rise'): number {
  const a = goodOf(tag)
  if (!a.length) return 0
  return a.reduce((s, t) => s + t[key], 0) / a.length
}

const strongN = computed(() => goodOf('강').length)
const weakN = computed(() => goodOf('약').length)
const strongVel = computed(() => avgOf('강', 'vel'))
const weakVel = computed(() => avgOf('약', 'vel'))
/**
 * 강 ÷ 약 — ③의 답이다.
 *
 * 이전 방식이 "범위 512~848(1.7배)"로 측정된 적이 있는데 그건 측정 오류였다(문턱을 넘는
 * 순간의 상승 구간 속도를 재고 있었다). 이 랩은 스윙이 끝날 때까지 최고 속도를 갱신하므로
 * 그 오류가 없다. 2배 이상이면 거리 매핑이 성립한다.
 */
const velRatio = computed(() =>
  weakVel.value > 0 ? +(strongVel.value / weakVel.value).toFixed(2) : 0,
)
const strongRise = computed(() => avgOf('강', 'rise'))
const weakRise = computed(() => avgOf('약', 'rise'))

const v3 = computed<Verdict>(() => {
  if (!strongN.value || !weakN.value)
    return {
      cls: 'wait',
      text: `강하게 5회 → 약하게 5회 던져주세요 (현재 강 ${strongN.value} / 약 ${weakN.value})`,
    }
  if (velRatio.value >= 2)
    return { cls: 'ok', text: '합격 — 스윙 세기로 거리를 조절할 수 있다' }
  if (velRatio.value >= 1.5)
    return { cls: 'warn', text: '애매 — 구분은 되지만 5단계로 나누기엔 좁다' }
  return { cls: 'bad', text: '미달 — 스윙 최고 속도로는 거리 구분이 안 된다. 다른 신호가 필요하다' }
})

function clearThrows() {
  throws.value = []
  throwSeq = 0
  lastThrowEndT = 0
}

/** 단계 탭에 붙는 완료 표시 */
const stepsMeta = computed(() => [
  { id: 1 as const, title: '어깨 너비', sub: '정규화 분모', done: v1.value.cls === 'ok' },
  { id: 2 as const, title: '릴 크랭크', sub: '진폭 문턱', done: v2.value.cls === 'ok' },
  { id: 3 as const, title: '캐스팅', sub: '강÷약 비율', done: v3.value.cls === 'ok' },
])

/* ────────────────────────── 공통 지표 ────────────────────────── */

const m = reactive({
  fps: 0,
  fpsMin: 0,
  inferMs: '–',
  /** 최근 창에서 양손 중 하나라도 놓친 프레임 비율(%) */
  lostPct: 0,
  /** 관측된 최저 미검출률 — 손을 제대로 들고 있을 때의 값 */
  lostPctMin: 100,
  /** 손목 visibility 최근 최솟값 */
  visMin: '–',
  /** 손이 안전 영역을 벗어난 누적 프레임 */
  outOfSafe: 0,
  /** 가장자리 최근접 비율(0=가장자리) */
  edgeMin: '–',
})

const pose = usePoseLandmarker()
const videoRef = ref<HTMLVideoElement>()
const canvasRef = ref<HTMLCanvasElement>()
const camError = ref<string | null>(null)
const loadProgress = ref(0)

const statusText = computed(() => {
  if (camError.value) return camError.value
  if (pose.error.value) return pose.error.value
  if (pose.isLoading.value) return `포즈 모델 로딩 중… ${Math.round(loadProgress.value * 100)}%`
  if (floorRunning.value) return '정지 기준선 측정 중 — 손을 가만히'
  if (!cast.visible) return '양손이 다 보이게 앉아주세요'
  if (cast.recording) return '던짐 기록 중…'
  return '측정 중'
})

/** 양 손목·어깨 히스토리 — 진폭·속도는 전부 여기서 낸다 */
interface Frame {
  t: number
  lx: number
  ly: number
  rx: number
  ry: number
  midY: number
}
let hist: Frame[] = []
/** 화면에 그리는 중점 궤적 */
let trail: { x: number; y: number }[] = []
/** 마지막 랜드마크 화면 좌표 — 렌더용 */
let marks: {
  lw: { x: number; y: number }
  rw: { x: number; y: number }
  ls: { x: number; y: number }
  rs: { x: number; y: number }
} | null = null

let stream: MediaStream | null = null
let statsTimer = 0
let rafId = 0

// 500ms 창 집계
let frames = 0
let lostWin = 0
let inferSum = 0
let visMinWin = 1
let edgeMinWin = 0.5

/** 창 안의 진폭(px) */
function ampIn(win: Frame[], pick: (f: Frame) => number): number {
  if (win.length < 2) return 0
  let lo = Infinity
  let hi = -Infinity
  for (const f of win) {
    const v = pick(f)
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return hi - lo
}

/** 창 양 끝의 기울기로 낸 하향 속도(px/s). 양수 = 아래로 */
function slope(win: Frame[]): number {
  if (win.length < 2) return 0
  const a = win[0]!
  const b = win[win.length - 1]!
  const dt = (b.t - a.t) / 1000
  return dt > 0 ? (b.midY - a.midY) / dt : 0
}

function onPose(result: PoseLandmarkerResult, inferenceMs: number) {
  frames++
  inferSum += inferenceMs
  const now = performance.now()
  const lm = result.landmarks?.[0]

  const wl = lm?.[WRIST.left]
  const wr = lm?.[WRIST.right]
  const sl = lm?.[SHOULDER.left]
  const srr = lm?.[SHOULDER.right]

  const wristsOk =
    !!wl && !!wr && (wl.visibility ?? 0) >= VIS_MIN && (wr.visibility ?? 0) >= VIS_MIN

  if (!wristsOk) {
    cast.visible = false
    cast.lost++
    lostWin++
    if (cast.recording) recLost = true
    marks = null
    return
  }

  visMinWin = Math.min(visMinWin, wl.visibility ?? 1, wr.visibility ?? 1)
  cast.visible = true

  // 거울 좌표 — 화면에 보이는 대로여야 숫자와 체감이 일치한다
  const lx = (1 - wl.x) * W
  const ly = wl.y * H
  const rx = (1 - wr.x) * W
  const ry = wr.y * H
  const midY = (ly + ry) / 2
  cast.midX = (lx + rx) / 2
  cast.midY = midY

  // 프레임 여유 — 두 손 중 가장자리에 가까운 쪽을 본다
  const edge = Math.min(wl.x, 1 - wl.x, wl.y, 1 - wl.y, wr.x, 1 - wr.x, wr.y, 1 - wr.y)
  edgeMinWin = Math.min(edgeMinWin, edge)
  if (edge < SAFE_INSET) m.outOfSafe++

  hist.push({ t: now, lx, ly, rx, ry, midY })
  while (hist.length && now - hist[0]!.t > THROW_WIN) hist.shift()

  trail.push({ x: cast.midX, y: midY })
  while (trail.length > TRAIL_MAX) trail.shift()

  // ── ① 어깨 너비 ──
  if (sl && srr && (sl.visibility ?? 0) >= VIS_MIN && (srr.visibility ?? 0) >= VIS_MIN) {
    const sx1 = (1 - sl.x) * W
    const sy1 = sl.y * H
    const sx2 = (1 - srr.x) * W
    const sy2 = srr.y * H
    marks = {
      lw: { x: lx, y: ly },
      rw: { x: rx, y: ry },
      ls: { x: sx1, y: sy1 },
      rs: { x: sx2, y: sy2 },
    }
    const width = Math.hypot(sx2 - sx1, sy2 - sy1)
    sw.now = width
    sw.n++
    swSum += width
    sw.avg = swSum / sw.n
    sw.min = sw.min === 0 ? width : Math.min(sw.min, width)
    sw.max = Math.max(sw.max, width)
  } else {
    marks = { lw: { x: lx, y: ly }, rw: { x: rx, y: ry }, ls: { x: 0, y: 0 }, rs: { x: 0, y: 0 } }
  }

  // ── ② 릴 크랭크 ──
  const crankWin = hist.filter((f) => now - f.t <= CRANK_WIN)
  const ampYL = ampIn(crankWin, (f) => f.ly)
  const ampYR = ampIn(crankWin, (f) => f.ry)
  const ampXL = ampIn(crankWin, (f) => f.lx)
  const ampXR = ampIn(crankWin, (f) => f.rx)
  // 2D 이동량이 큰 쪽을 크랭크 손으로 본다 — 대를 잡은 손은 상대적으로 정지해 있다.
  // 히스테리시스 없이 고르면 매 프레임 뒤바뀌어 pump에 먹이는 신호가 끊긴다.
  const move = { left: Math.hypot(ampXL, ampYL), right: Math.hypot(ampXR, ampYR) }
  const other = crank.side === 'right' ? 'left' : 'right'
  if (autoSide.value && move[other] > move[crank.side] * CRANK_SWITCH) crank.side = other

  const isRight = crank.side === 'right'
  crank.ampY = isRight ? ampYR : ampYL
  crank.ampX = isRight ? ampXR : ampXL
  crank.restAmpY = isRight ? ampYL : ampYR

  // 정지 기준선 측정 중에는 노이즈만 모으고 진폭 최대값은 오염시키지 않는다.
  // 최대값은 ② 탭에서만 누적한다 — 캐스팅 스윙(③)이 크랭크보다 커서 섞이면 문턱 후보가 부푼다.
  if (floorRunning.value) {
    crank.floor = Math.max(crank.floor, crank.ampY)
    if (now >= floorUntil) floorRunning.value = false
  } else if (step.value === 2) {
    crank.ampYMax = Math.max(crank.ampYMax, crank.ampY)
  }

  /*
   * ②는 ② 탭에서만 센다.
   *
   * 게임에서 릴 감기와 캐스팅은 **동시에 존재하지 않는 페이즈**다(찌를 던지기 전 vs 물고기가
   * 걸린 뒤). 랩에서 둘을 같이 돌리면 크랭크의 y 하향 구간이 던짐 문턱을 넘어 **회전 한 바퀴가
   * 던짐 한 번으로 기록된다** — 2026-07-30 실측 6세션 전부에서 `기록 수 ≈ 누적 왕복 수`로
   * 나타났다(예: 12왕복 → 11건). 이전 랩에 있던 `activeJudge` 가드를 재작성 때 빠뜨린 결과다.
   */
  if (step.value === 2) {
    const cy = isRight ? ry : ly
    // 랩은 문턱을 **찾는** 중이므로 슬라이더 값을 px 그대로 쓴다 — 어깨너비를 1로 넣어
    // pump의 sw 정규화를 우회한다. 확정된 배수는 판정기(DEFAULT_PUMP)가 들고 있다.
    const p = crankPump.feed(cy, 1, now)
    crank.rate = p.rate
    crank.revs = p.revs
    crank.active = p.active
    const cd = crankPump.debug()
    const csec = (cd.lastTick - cd.firstTick) / 1000
    if (cd.halves >= 3 && csec > 0) {
      crank.avgRate = (cd.halves - 1) / 2 / csec
      crank.sec = csec
    }
  }

  // ── ③ 캐스팅 (양손 중점) ──
  const velWin = hist.filter((f) => now - f.t <= VEL_WIN)
  const vel = slope(velWin)
  cast.vel = vel
  /*
   * 상승 거리는 **지난 던짐이 끝난 뒤**의 구간에서만 잰다.
   *
   * 창 전체(1500ms)를 쓰면 직전 스윙의 낙하가 최저점으로 잡혀 상승 거리가 부풀고, 반대로
   * 기록을 닫을 때 hist를 잘라버리면 연달아 던질 때 창이 덜 찬 상태로 재서 줄어든다.
   * 기준 시각만 옮기면 둘 다 피하면서 크랭크 측정용 창(②)도 건드리지 않는다.
   */
  const riseWin = hist.filter((f) => f.t >= lastThrowEndT)
  const topY = Math.min(...riseWin.map((f) => f.midY))
  const restY = Math.max(...riseWin.map((f) => f.midY))
  cast.topY = topY
  cast.restY = restY

  // ③도 ③ 탭에서만 기록한다 — 위 ② 주석과 같은 이유(크랭크 회전이 던짐으로 기록된다)
  if (step.value !== 3) {
    cast.recording = false
    return
  }

  if (!cast.recording) {
    if (vel >= THROW_START_VEL && now >= cooldownUntil) {
      cast.recording = true
      recVel = vel
      // 상승 거리 = 구간 안의 최저점에서 최고점까지. 백스윙이 얼마나 컸는지다
      recRise = restY - topY
      recTop = topY
      recLost = false
    }
  } else {
    if (vel > recVel) recVel = vel
    const ended = vel < recVel * THROW_END_RATIO || vel < 120
    if (ended) {
      throwSeq++
      throws.value = [
        ...throws.value,
        {
          n: throwSeq,
          tag: throwTag.value,
          rise: Math.round(recRise),
          drop: Math.round(midY - recTop),
          vel: Math.round(recVel),
          velSw: sw.avg > 0 ? +(recVel / sw.avg).toFixed(2) : 0,
          lost: recLost,
        },
      ].slice(-14)
      cast.recording = false
      cooldownUntil = now + THROW_COOLDOWN
      // 다음 던짐의 상승 거리를 이번 스윙과 섞지 않는다 (hist는 ②가 쓰므로 자르지 않는다)
      lastThrowEndT = now
    }
  }
}

function flushStats() {
  m.fps = frames * 2
  if (m.fps > 0) m.fpsMin = m.fpsMin === 0 ? m.fps : Math.min(m.fpsMin, m.fps)
  m.inferMs = frames ? (inferSum / frames).toFixed(1) : '–'
  if (frames) {
    m.lostPct = Math.round((lostWin / frames) * 100)
    m.lostPctMin = Math.min(m.lostPctMin, m.lostPct)
  }
  m.visMin = visMinWin < 1 ? visMinWin.toFixed(2) : '–'
  m.edgeMin = edgeMinWin < 0.5 ? edgeMinWin.toFixed(3) : '–'
  frames = 0
  lostWin = 0
  inferSum = 0
  visMinWin = 1
  edgeMinWin = 0.5
}

/**
 * 탭을 옮기면 공유 신호 버퍼를 끊는다.
 *
 * `hist`는 ②(진폭)와 ③(스윙 속도)이 같이 쓴다. 안 끊으면 릴을 돌리다 ③으로 넘어간 순간
 * 마지막 회전의 하향 구간이 던짐 한 건으로 기록된다 — 페이즈를 갈라놓는 의미가 없어진다.
 * 누적 결과(ampYMax·floor·throws)는 남긴다. 전체 초기화는 `리셋` 버튼이 한다.
 */
watch(step, () => {
  hist = []
  trail = []
  cast.recording = false
  lastThrowEndT = 0
  cooldownUntil = 0
  crankPump.reset()
  crank.rate = 0
  crank.active = false
})

function resetAll() {
  hist = []
  trail = []
  crankPump.reset()
  Object.assign(crank, {
    ampY: 0,
    ampX: 0,
    ampYMax: 0,
    restAmpY: 0,
    rate: 0,
    avgRate: 0,
    sec: 0,
    revs: 0,
    active: false,
    floor: 0,
  })
  Object.assign(sw, { now: 0, min: 0, max: 0, avg: 0, n: 0 })
  swSum = 0
  cast.lost = 0
  cast.recording = false
  clearThrows()
  m.fpsMin = 0
  m.outOfSafe = 0
  m.lostPctMin = 100
}

/**
 * 측정값 한 줄 요약 — 화면을 통째로 긁는 대신 결정에 쓰는 숫자만 모은다.
 * 보고 있는 단계와 무관하게 **세 측정 전부** 담는다.
 */
function snapshotText(): string {
  const n = (v: number, d = 2) => v.toFixed(d)
  const rows = throws.value
    .map(
      (t) =>
        `  #${t.n} ${t.tag} 상승=${t.rise}px 낙하=${t.drop}px 최고속도=${t.vel}px/s (${t.velSw}sw/s)${t.lost ? ' ⚠손실' : ''}`,
    )
    .join('\n')
  return [
    `[낚시랩 재설계 실측] 크랭크손=${crank.side === 'right' ? '오른손' : '왼손'}${autoSide.value ? '(자동)' : '(수동)'}`,
    `① 어깨너비: 평균=${Math.round(sw.avg)}px 최소=${Math.round(sw.min)} 최대=${Math.round(sw.max)} 변동=${swVarPct.value}% (${sw.n}f) → ${v1.value.cls}`,
    `② 크랭크: y진폭최대=${Math.round(crank.ampYMax)}px = 어깨너비×${crankAmpSw.value} / 현재=${Math.round(crank.ampY)}px`,
    `   x진폭=${Math.round(crank.ampX)}px 종횡비=${crankAspect.value} 대잡은손=${Math.round(crank.restAmpY)}px 구분=${handsSeparated.value ? 'OK' : 'NG'}`,
    `   정지기준선=${Math.round(crank.floor)}px 문턱후보=${crankSuggest.value}px (슬라이더 ${crankCfg.minAmpSw}px, active=${crank.active}) → ${v2.value.cls}`,
    `   속도: 지속=${n(crank.avgRate)}/s (${n(crank.sec, 1)}s 구간) 순간=${n(crank.rate)} 누적=${n(crank.revs)}왕복`,
    `③ 캐스팅: 강평균=${Math.round(strongVel.value)}px/s(n=${strongN.value}) 약평균=${Math.round(weakVel.value)}px/s(n=${weakN.value}) **비율=${velRatio.value}배** → ${v3.value.cls}`,
    `   상승: 강=${Math.round(strongRise.value)}px 약=${Math.round(weakRise.value)}px`,
    rows || '   (던짐 기록 없음)',
    `지표: fps=${m.fps}(최저${m.fpsMin}) 추론=${m.inferMs}ms 양손미검출=최저${m.lostPctMin}%/현재${m.lostPct}%(${cast.lost}f) vis=${m.visMin} 가장자리=${m.edgeMin} 이탈=${m.outOfSafe}f`,
  ].join('\n')
}

const copied = ref(false)
async function copySnapshot() {
  try {
    await navigator.clipboard.writeText(snapshotText())
  } catch {
    snapshotForBox.value = snapshotText()
    showSnapshot.value = true
    return
  }
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

const showSnapshot = ref(false)
const snapshotForBox = ref('')
function toggleSnapshotBox() {
  snapshotForBox.value = snapshotText()
  showSnapshot.value = !showSnapshot.value
}

/* ────────────────────────── 렌더 ────────────────────────── */

function draw() {
  rafId = requestAnimationFrame(draw)
  const cv = canvasRef.value
  const video = videoRef.value
  if (!cv || !video) return
  const ctx = cv.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, W, H)

  if (video.readyState >= 2) {
    ctx.save()
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
    ctx.globalAlpha = 0.55
    ctx.drawImage(video, 0, 0, W, H)
    ctx.restore()
  } else {
    ctx.fillStyle = '#10131c'
    ctx.fillRect(0, 0, W, H)
  }

  // 안전 영역
  ctx.save()
  ctx.strokeStyle = 'rgba(255,210,63,0.35)'
  ctx.setLineDash([6, 6])
  ctx.lineWidth = 1.5
  ctx.strokeRect(W * SAFE_INSET, H * SAFE_INSET, W * (1 - SAFE_INSET * 2), H * (1 - SAFE_INSET * 2))
  ctx.restore()

  if (!marks) return

  // 어깨 선 — ①에서만 강조한다. 다른 단계에서는 흐리게 둬 시선을 뺏지 않는다
  if (marks.ls.x > 0 || marks.rs.x > 0) {
    const on = step.value === 1
    ctx.save()
    ctx.strokeStyle = on ? '#3DDCFF' : 'rgba(61,220,255,0.25)'
    ctx.lineWidth = on ? 3 : 1.5
    ctx.beginPath()
    ctx.moveTo(marks.ls.x, marks.ls.y)
    ctx.lineTo(marks.rs.x, marks.rs.y)
    ctx.stroke()
    if (on) {
      ctx.fillStyle = '#3DDCFF'
      ctx.font = 'bold 13px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(
        `${Math.round(sw.now)}px`,
        (marks.ls.x + marks.rs.x) / 2,
        Math.min(marks.ls.y, marks.rs.y) - 10,
      )
    }
    ctx.restore()
  }

  // 크랭크 손 y 진폭 밴드 — ②에서만
  const ch = crank.side === 'right' ? marks.rw : marks.lw
  const now = performance.now()
  const win = hist.filter((f) => now - f.t <= CRANK_WIN)
  if (step.value === 2 && win.length >= 2) {
    const ys = win.map((f) => (crank.side === 'right' ? f.ry : f.ly))
    const lo = Math.min(...ys)
    const hi = Math.max(...ys)
    ctx.save()
    ctx.strokeStyle = crank.active ? 'rgba(198,255,94,0.7)' : 'rgba(147,161,201,0.45)'
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    for (const y of [lo, hi]) {
      ctx.beginPath()
      ctx.moveTo(ch.x - 70, y)
      ctx.lineTo(ch.x + 70, y)
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.strokeStyle = crank.active ? '#C6FF5E' : '#93A1C9'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(ch.x + 74, lo)
    ctx.lineTo(ch.x + 74, hi)
    ctx.stroke()
    ctx.fillStyle = crank.active ? '#C6FF5E' : '#93A1C9'
    ctx.font = 'bold 13px monospace'
    ctx.textAlign = 'left'
    ctx.fillText(`${Math.round(hi - lo)}px`, ch.x + 82, (lo + hi) / 2)
    ctx.restore()
  }

  // 중점 궤적 — ③에서만
  if (step.value === 3 && trail.length >= 2) {
    ctx.save()
    ctx.strokeStyle = cast.recording ? 'rgba(255,93,115,0.85)' : 'rgba(255,210,63,0.5)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(trail[0]!.x, trail[0]!.y)
    for (const p of trail.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.restore()
  }

  // 손목 2개 — ②에서만 크랭크 손을 강조한다
  const hi2 = step.value === 2
  for (const [pt, isCrank] of [
    [marks.lw, crank.side === 'left'] as const,
    [marks.rw, crank.side === 'right'] as const,
  ]) {
    const on = hi2 && isCrank
    ctx.save()
    const color = on ? '#C6FF5E' : '#93A1C9'
    ctx.shadowColor = color
    ctx.shadowBlur = on ? 14 : 4
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, on ? 11 : 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // 양손 중점 — ③에서만
  if (step.value === 3) {
    ctx.save()
    ctx.fillStyle = cast.recording ? '#FF5D73' : '#FFD23F'
    ctx.shadowColor = ctx.fillStyle
    ctx.shadowBlur = 12
    ctx.beginPath()
    ctx.arc(cast.midX, cast.midY, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

onMounted(async () => {
  draw()
  statsTimer = window.setInterval(flushStats, 500)

  preloadPoseLandmarker((f) => (loadProgress.value = f))
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: W, height: H },
      audio: false,
    })
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
  window.clearInterval(statsTimer)
  cancelAnimationFrame(rafId)
  pose.stop()
  stream?.getTracks().forEach((t) => t.stop())
})
</script>

<template>
  <div class="lab">
    <header class="bar">
      <h1>낚시 랩</h1>
      <span class="status" :class="{ err: !!camError || !!pose.error.value }">{{ statusText }}</span>
      <div class="copybar">
        <button type="button" class="copy" @click="copySnapshot">
          {{ copied ? '복사됨 ✓' : '측정값 복사' }}
        </button>
        <button type="button" @click="toggleSnapshotBox">원문</button>
        <button type="button" @click="resetAll">리셋</button>
      </div>
    </header>

    <textarea
      v-if="showSnapshot"
      class="snapbox"
      readonly
      rows="12"
      :value="snapshotForBox"
      @focus="(e) => (e.target as HTMLTextAreaElement).select()"
    />

    <!-- 단계 레일 — 측정은 ①→②→③ 순서로 하나씩. 한 번에 한 단계만 펼친다 -->
    <nav class="rail">
      <button
        v-for="s in stepsMeta"
        :key="s.id"
        type="button"
        :class="['tab', { on: step === s.id, done: s.done }]"
        @click="step = s.id"
      >
        <b class="n">{{ s.id }}</b>
        <span class="t">{{ s.title }}</span>
        <span class="s">{{ s.sub }}</span>
        <span v-if="s.done" class="ck">✓</span>
      </button>
    </nav>

    <div class="body">
      <div class="stagewrap">
        <div class="stage">
          <canvas ref="canvasRef" :width="W" :height="H" />
          <video ref="videoRef" playsinline muted class="hidden-video" />
        </div>
        <p class="legend">
          <template v-if="step === 1"
            ><i class="k cy" />어깨 선 — 이 길이가 분모다</template
          >
          <template v-else-if="step === 2">
            <i class="k li" />크랭크 손 <i class="k sl" />대 잡은 손
            <i class="k bar" />y 진폭 (초록 = 감기 인정)
          </template>
          <template v-else><i class="k am" />양손 중점 (빨강 = 던짐 기록 중)</template>
          <span class="sp"><i class="k dash" />안전 영역 — 밖으로 나가면 인식이 끊긴다</span>
        </p>
      </div>

      <aside class="panel">
        <!-- ① 어깨 너비 -->
        <template v-if="step === 1">
          <p class="todo">
            평소 낚시할 때처럼 <b>앉은 자세로 양손을 화면에 두고</b> 조금씩 몸을 움직인다.
            2초면 판정이 나온다.
          </p>
          <div class="answer" :class="v1.cls">
            <div class="q">어깨 너비를 분모로 쓸 수 있나?</div>
            <div class="v">{{ swVarPct }}<small>%</small></div>
            <div class="k2">변동폭 (합격 기준: 10% 이하)</div>
            <div class="lbl">{{ v1.text }}</div>
          </div>
          <div class="tiles">
            <div class="tile">
              <span>평균</span><b>{{ Math.round(sw.avg) }}<em>px</em></b>
            </div>
            <div class="tile">
              <span>최소</span><b>{{ Math.round(sw.min) }}</b>
            </div>
            <div class="tile">
              <span>최대</span><b>{{ Math.round(sw.max) }}</b>
            </div>
          </div>
          <details>
            <summary>왜 이 값이 필요한가</summary>
            <p>
              지금 판정 문턱은 전부 캔버스 px이라 <b>카메라에서 멀어지면 같은 동작이 작고 느리게
              측정된다</b>. 문턱을 어깨너비 배수로 바꾸면 그게 사라진다. 단 분모가 흔들리면 정규화
              자체가 성립하지 않아서, 앉은 자세에서의 변동폭을 먼저 확인한다.
              30%를 넘으면 매 프레임 값이 아니라 <b>관측 최대값</b>을 분모로 써야 한다.
            </p>
          </details>
        </template>

        <!-- ② 릴 크랭크 -->
        <template v-else-if="step === 2">
          <p class="todo">
            ⓐ <b>정지 기준선</b>을 먼저 잰다(버튼 → 손 가만히 2초) → ⓑ 한 손은 낚싯대 쥔 자세로
            두고 <b>다른 손으로 평소처럼 릴을 돌린다</b>(20바퀴).
          </p>
          <div class="btns">
            <button
              type="button"
              class="prime"
              :class="{ active: floorRunning }"
              @click="startFloor"
            >
              {{ floorRunning ? '측정 중… 손 가만히' : 'ⓐ 정지 기준선 재기 (2초)' }}
            </button>
          </div>
          <div class="answer" :class="v2.cls">
            <div class="q">릴 감기 진폭 문턱을 얼마로?</div>
            <div class="v">{{ crankSuggest || '–' }}<small>px</small></div>
            <div class="k2">
              노이즈 {{ Math.round(crank.floor) }}px ↔ 실측 {{ Math.round(crank.ampYMax) }}px 사이
            </div>
            <div class="lbl">{{ v2.text }}</div>
          </div>
          <div class="tiles">
            <div class="tile" :class="{ live: crank.active }">
              <span>y 진폭 (지금)</span><b>{{ Math.round(crank.ampY) }}<em>px</em></b>
            </div>
            <div class="tile">
              <span>어깨너비 배수</span><b>×{{ crankAmpSw }}</b>
            </div>
            <div class="tile">
              <span>지속 속도</span><b>{{ crank.avgRate.toFixed(2) }}<em>왕복/s</em></b>
            </div>
            <div class="tile" :class="handsSeparated ? 'good' : 'warnt'">
              <span>두 손 구분</span><b>{{ handsSeparated ? 'OK' : 'NG' }}</b>
            </div>
          </div>
          <div class="btns">
            <span class="mini">크랭크 손</span>
            <button type="button" :class="{ active: autoSide }" @click="autoSide = true">자동</button>
            <button
              type="button"
              :class="{ active: !autoSide && crank.side === 'right' }"
              @click="((autoSide = false), (crank.side = 'right'))"
            >
              오른손
            </button>
            <button
              type="button"
              :class="{ active: !autoSide && crank.side === 'left' }"
              @click="((autoSide = false), (crank.side = 'left'))"
            >
              왼손
            </button>
          </div>
          <details>
            <summary>자세히 — 원시값과 문턱 실험</summary>
            <dl>
              <dt>x 진폭</dt>
              <dd>{{ Math.round(crank.ampX) }} px</dd>
              <dt>종횡비 (x÷y)</dt>
              <dd>{{ crankAspect }}</dd>
              <dt>대 잡은 손 진폭</dt>
              <dd>{{ Math.round(crank.restAmpY) }} px</dd>
              <dt>순간 속도</dt>
              <dd>{{ crank.rate.toFixed(2) }} /s</dd>
              <dt>누적</dt>
              <dd>{{ crank.revs.toFixed(2) }} 왕복 / {{ crank.sec.toFixed(1) }}s</dd>
            </dl>
            <label>
              문턱 직접 실험 <output>{{ crankCfg.minAmpSw }}px</output>
              <input v-model.number="crankCfg.minAmpSw" type="range" min="4" max="200" step="2" />
            </label>
            <p>
              슬라이더를 올려가며 <b>y 진폭 타일이 초록에서 회색으로 바뀌는 지점</b>을 보면 여유를
              눈으로 확인할 수 있다. 기본 6px은 측정을 막지 않기 위한 값이고 판정 후보가 아니다.
            </p>
          </details>
        </template>

        <!-- ③ 캐스팅 -->
        <template v-else>
          <p class="todo">
            <b>양손으로 낚싯대를 쥔 자세</b>로 뒤로 젖혔다 앞으로 던진다. 어깨 위에서 멈추는 단계는
            없다 — 한 동작으로. <b>강하게 5회</b> 던진 뒤 버튼을 바꿔 <b>약하게 5회</b>.
          </p>
          <div class="btns">
            <button
              type="button"
              class="prime"
              :class="{ active: throwTag === '강' }"
              @click="throwTag = '강'"
            >
              강하게 기록 중 ({{ strongN }})
            </button>
            <button
              type="button"
              class="prime"
              :class="{ active: throwTag === '약' }"
              @click="throwTag = '약'"
            >
              약하게 기록 중 ({{ weakN }})
            </button>
          </div>
          <div class="answer" :class="v3.cls">
            <div class="q">스윙 세기로 거리를 조절할 수 있나?</div>
            <div class="v">{{ velRatio || '–' }}<small>배</small></div>
            <div class="k2">강 ÷ 약 (합격 기준: 2배 이상)</div>
            <div class="lbl">{{ v3.text }}</div>
          </div>
          <div class="tiles">
            <div class="tile">
              <span>강 평균</span><b>{{ Math.round(strongVel) }}<em>px/s</em></b>
            </div>
            <div class="tile">
              <span>약 평균</span><b>{{ Math.round(weakVel) }}<em>px/s</em></b>
            </div>
            <div class="tile" :class="{ live: cast.recording }">
              <span>지금 하향</span><b>{{ Math.round(cast.vel) }}<em>px/s</em></b>
            </div>
          </div>
          <table v-if="throws.length" class="rec">
            <thead>
              <tr>
                <th>#</th>
                <th>세기</th>
                <th>상승</th>
                <th>낙하</th>
                <th>최고속도</th>
                <th>sw/s</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in [...throws].reverse()" :key="t.n" :class="{ lost: t.lost }">
                <td>{{ t.n }}</td>
                <td>{{ t.tag }}</td>
                <td>{{ t.rise }}</td>
                <td>{{ t.drop }}</td>
                <td>{{ t.vel }}</td>
                <td>{{ t.velSw }}</td>
              </tr>
            </tbody>
          </table>
          <div class="btns">
            <button type="button" @click="clearThrows">기록 지우기</button>
          </div>
          <details>
            <summary>자세히 — 상승 거리와 손실 기록</summary>
            <dl>
              <dt>상승 강 / 약</dt>
              <dd>{{ Math.round(strongRise) }} / {{ Math.round(weakRise) }} px</dd>
            </dl>
            <p>
              <b>취소선</b>이 그어진 기록은 던지는 중 손을 놓친 것으로 평균에서 빠진다. 그게 많으면
              양손 캐스팅 자체가 노트북 화각에 안 들어온다는 뜻이라, 동작을 작게 바꿔야 한다.
            </p>
          </details>
        </template>

        <!-- 항상 보이는 얇은 지표 줄 -->
        <div class="strip">
          <span>fps <b>{{ m.fps }}</b><em>/{{ m.fpsMin }}</em></span>
          <span>추론 <b>{{ m.inferMs }}</b><em>ms</em></span>
          <span :class="m.lostPctMin <= 5 ? 'ok' : 'bad'">
            미검출 <b>{{ m.lostPctMin }}%</b>
          </span>
          <span>vis <b>{{ m.visMin }}</b></span>
          <span>이탈 <b>{{ m.outOfSafe }}</b><em>f</em></span>
        </div>
      </aside>
    </div>

    <p class="foot">
      <b>지금 열려 있는 탭만 측정한다.</b> 게임에서 릴 감기와 캐스팅은 동시에 존재하지 않는
      페이즈라 랩도 하나씩 잰다 — 같이 돌리면 크랭크 회전의 하향 구간이 던짐으로 기록된다.<br />
      끝나면 <b>측정값 복사</b> — 보고 있는 단계와 무관하게 세 측정 전부 담긴다.
    </p>
  </div>
</template>

<style scoped>
.lab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  min-height: 100vh;
  background: #0b1330;
  color: #f4f0ff;
  font-family: system-ui, sans-serif;
}
.bar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
h1 {
  font-size: 17px;
  margin: 0;
}
.status {
  font-size: 12px;
  color: #93a1c9;
}
.status.err {
  color: #ff5d73;
}
.copybar {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

/* 단계 레일 */
.rail {
  display: flex;
  gap: 8px;
}
.tab {
  flex: 1;
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  gap: 0 10px;
  text-align: left;
  padding: 10px 14px;
  background: #152049;
  border: 1px solid rgba(244, 240, 255, 0.1);
  border-radius: 12px;
  cursor: pointer;
  color: #93a1c9;
}
.tab:hover {
  background: #1c2a5e;
}
.tab .n {
  grid-row: 1 / 3;
  font-size: 20px;
  font-family: ui-monospace, monospace;
  color: #4d5f92;
}
.tab .t {
  font-size: 14px;
  font-weight: 700;
  color: #f4f0ff;
}
.tab .s {
  grid-column: 2;
  font-size: 11px;
}
.tab .ck {
  grid-row: 1 / 3;
  color: #c6ff5e;
  font-size: 15px;
}
.tab.on {
  background: #24346f;
  border-color: #3ddcff;
}
.tab.on .n {
  color: #3ddcff;
}
.tab.done {
  border-color: rgba(198, 255, 94, 0.55);
}

.body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.stagewrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.stage {
  position: relative;
  border: 1px solid rgba(244, 240, 255, 0.12);
  border-radius: 12px;
  overflow: hidden;
  background: #0d1128;
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
  pointer-events: none;
  top: 0;
  left: 0;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  margin: 0;
  font-size: 11.5px;
  color: #93a1c9;
  max-width: 640px;
}
.legend .sp {
  margin-left: auto;
}
.k {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: -1px;
}
.k.cy {
  background: #3ddcff;
  border-radius: 2px;
  width: 16px;
  height: 3px;
}
.k.li {
  background: #c6ff5e;
}
.k.sl {
  background: #93a1c9;
}
.k.am {
  background: #ffd23f;
}
.k.bar {
  background: #c6ff5e;
  width: 3px;
  height: 13px;
  border-radius: 2px;
}
.k.dash {
  width: 16px;
  height: 0;
  border-top: 2px dashed rgba(255, 210, 63, 0.7);
  border-radius: 0;
}

.panel {
  flex: 1 1 380px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.todo {
  margin: 0;
  padding: 11px 14px;
  background: rgba(61, 220, 255, 0.08);
  border-left: 3px solid #3ddcff;
  border-radius: 0 10px 10px 0;
  font-size: 13px;
  line-height: 1.65;
  color: #cfe4ff;
}
.todo b {
  color: #fff;
}

/* 이 단계의 답 — 화면에서 가장 큰 숫자는 언제나 하나여야 한다 */
.answer {
  background: #152049;
  border: 1px solid rgba(244, 240, 255, 0.12);
  border-radius: 14px;
  padding: 14px 16px;
  text-align: center;
}
.answer .q {
  font-size: 12px;
  color: #93a1c9;
}
.answer .v {
  font-family: ui-monospace, monospace;
  font-size: 52px;
  font-weight: 800;
  line-height: 1.1;
  margin: 2px 0;
}
.answer .v small {
  font-size: 20px;
  margin-left: 3px;
  opacity: 0.7;
}
.answer .k2 {
  font-size: 11px;
  color: #93a1c9;
  font-family: ui-monospace, monospace;
}
.answer .lbl {
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid rgba(244, 240, 255, 0.1);
  font-size: 12.5px;
  line-height: 1.5;
}
.answer.ok {
  border-color: #c6ff5e;
  background: rgba(198, 255, 94, 0.09);
}
.answer.ok .v,
.answer.ok .lbl {
  color: #c6ff5e;
}
.answer.warn {
  border-color: #ffd23f;
  background: rgba(255, 210, 63, 0.08);
}
.answer.warn .v,
.answer.warn .lbl {
  color: #ffd23f;
}
.answer.bad {
  border-color: #ff5d73;
  background: rgba(255, 93, 115, 0.08);
}
.answer.bad .v,
.answer.bad .lbl {
  color: #ff5d73;
}
.answer.wait .v {
  color: #4d5f92;
}
.answer.wait .lbl {
  color: #93a1c9;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
  gap: 8px;
}
.tile {
  background: #152049;
  border: 1px solid rgba(244, 240, 255, 0.1);
  border-radius: 10px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tile span {
  font-size: 10.5px;
  color: #93a1c9;
}
.tile b {
  font-family: ui-monospace, monospace;
  font-size: 17px;
}
.tile b em {
  font-size: 10px;
  color: #93a1c9;
  font-style: normal;
  margin-left: 2px;
}
.tile.live {
  border-color: #c6ff5e;
}
.tile.live b {
  color: #c6ff5e;
}
.tile.good b {
  color: #c6ff5e;
}
.tile.warnt b {
  color: #ff5d73;
}

.btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.mini {
  font-size: 11px;
  color: #93a1c9;
}
button {
  background: #1c2a5e;
  color: #f4f0ff;
  border: 1px solid rgba(244, 240, 255, 0.14);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}
button:hover {
  background: #24346f;
}
button.prime {
  flex: 1;
  padding: 10px 12px;
  font-size: 13px;
}
button.active {
  background: #c6ff5e;
  color: #101a12;
  border-color: #c6ff5e;
  font-weight: 700;
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

details {
  background: #152049;
  border: 1px solid rgba(244, 240, 255, 0.1);
  border-radius: 10px;
  padding: 9px 13px;
  font-size: 12px;
  color: #93a1c9;
}
summary {
  cursor: pointer;
  color: #cfe4ff;
  font-size: 12px;
}
details p {
  line-height: 1.65;
  margin: 8px 0 0;
}
details b {
  color: #f4f0ff;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
  margin: 9px 0 0;
  font-size: 12px;
}
dt {
  color: #93a1c9;
}
dd {
  margin: 0;
  font-family: ui-monospace, monospace;
  text-align: right;
  color: #f4f0ff;
}
label {
  display: grid;
  gap: 4px;
  font-size: 11.5px;
  color: #93a1c9;
  margin: 10px 0 0;
}
label output {
  font-family: ui-monospace, monospace;
  color: #f4f0ff;
}
label input {
  width: 100%;
}

table.rec {
  width: 100%;
  border-collapse: collapse;
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
  background: #152049;
  border-radius: 10px;
  overflow: hidden;
}
table.rec th {
  color: #93a1c9;
  font-weight: 400;
  text-align: right;
  padding: 5px 8px;
  background: #1c2a5e;
}
table.rec td {
  text-align: right;
  padding: 3px 8px;
}
table.rec tr.lost td {
  color: #ff5d73;
  text-decoration: line-through;
}

.strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding: 8px 12px;
  background: #101a3d;
  border: 1px solid rgba(244, 240, 255, 0.08);
  border-radius: 10px;
  font-size: 11px;
  color: #93a1c9;
}
.strip b {
  font-family: ui-monospace, monospace;
  color: #f4f0ff;
  margin-left: 3px;
}
.strip em {
  font-style: normal;
  opacity: 0.6;
}
.strip .ok b {
  color: #c6ff5e;
}
.strip .bad b {
  color: #ff5d73;
}

.snapbox {
  width: 100%;
  background: #0d1128;
  color: #f4f0ff;
  border: 1px solid rgba(198, 255, 94, 0.4);
  border-radius: 10px;
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
  line-height: 1.6;
  resize: vertical;
}
.foot {
  margin: 0;
  font-size: 11.5px;
  color: #93a1c9;
  line-height: 1.6;
}
.foot b {
  color: #f4f0ff;
}
</style>
