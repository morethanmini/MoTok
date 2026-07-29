<script setup lang="ts">
/**
 * 낚시 랩 (/dev/fishing-lab) — 게임⑤ 릴 감기 판정 실측 도구 (S15P11A706-10).
 *
 * 판단 목표 3개 (전부 노트북 웹캠·앉은 자세 기준):
 *  ① 빠르게 돌릴 때 손목을 놓치는가 → 손실률·최저 신뢰도
 *  ② 손이 화면 어디까지 나가면 끊기는가 → 프레임 여유 가이드 + 이탈 카운터
 *  ③ 조명이 어두우면 fps가 얼마나 떨어지는가 → 현재/최저 fps
 *
 * 부수적으로 reel.ts의 튜닝값(궤도 반경·섹터·밴드·창·최소런)을 슬라이더로 확정한다.
 * 확정된 값은 reel.ts의 DEFAULT_REEL 기본값을 덮어써서 본 게임으로 가져간다.
 *
 * 필터를 일부러 안 넣었다 — 릴 판정은 raw 손목이 맞다. One Euro는 정지 안정성에
 * 맞춰진 값이라 회전을 위상지연·진폭압축시킨다. 지터는 reel.ts의 minRun이 흡수한다.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  preloadPoseLandmarker,
  usePoseLandmarker,
  type PoseLandmarkerResult,
} from '@/composables/usePoseLandmarker'
import { createReel, DEFAULT_REEL, type Reel } from './reel'
import { createLoopFitter, DEFAULT_LOOP_FIT, type Loop } from './loopFit'
import { createPump, DEFAULT_PUMP } from './pump'
import { createCast, DEFAULT_CAST, type CastPhase } from './cast'
import { createFight, FISH, idealCatchSeconds, type FightState } from './fight'

/** MediaPipe Pose 손목 랜드마크 인덱스 */
const WRIST = { left: 15, right: 16 } as const
/** 같은 쪽 어깨 — 캐스팅의 "손목이 어깨보다 위" 판정 기준 */
const SHOULDER = { left: 11, right: 12 } as const
/** 이 값 미만이면 손목을 못 본 것으로 취급 */
const VIS_MIN = 0.5
/** 프레임 여유 가이드 — 화면 가장자리에서 이만큼 안쪽을 "안전 영역"으로 표시 */
const SAFE_INSET = 0.08

const W = 640
const H = 480

const cfg = reactive({ ...DEFAULT_REEL })
/**
 * 궤도 세로 반경(장축) — 캔버스 높이 대비 비율.
 * 0.14는 2026-07-29 실기 자동 맞춤 실측값(노트북 웹캠·앉은 자세·오른손 크랭크).
 * 처음 가정했던 0.19보다 작다 — 사람은 생각보다 작게 돌린다.
 */
const trackR = ref(0.14)
/**
 * 궤도 종횡비 = 가로 반경 ÷ 세로 반경. 1이면 원.
 * 실제 릴 크랭크는 회전면이 비스듬해 화면에 세로로 납작하게 찍힌다(2026-07-29 실기).
 * 0.55가 실측값 — 내가 가정했던 0.24보다 훨씬 덜 납작하다. 원(1.0)으로 판정하면
 * 6바퀴 중 1.5바퀴만 인정되던 것이 이 값으로 맞추면 끊김 없이 이어진다.
 */
const trackAspect = ref(0.55)
const handSide = ref<'right' | 'left'>('right')

/**
 * 자동 추적 모드 — 궤도를 그려놓고 맞추게 하는 대신, 손이 그리는 루프를 매 프레임 찾아
 * 궤도를 거기에 맞춘다. 유저 부담이 없고 사람마다 다른 종횡비에 자동 적응한다.
 * 기본 ON — 실기에서 "그려진 궤도 따라 돌기"가 답답했다(2026-07-29).
 */
const autoTrack = ref(true)
/** 참조 공유 — 슬라이더를 움직이면 다음 프레임부터 바로 반영된다 */
const fitCfg = reactive({ ...DEFAULT_LOOP_FIT })
const fitter = createLoopFitter(fitCfg)
/** 자동 추적이 찾아낸 루프 — 화면에는 "우리가 이렇게 보고 있다"는 거울로 그린다 */
let fittedLoop: Loop | null = null
const fitReason = ref<'ok' | 'few' | 'still' | 'line'>('few')

/**
 * 펌핑 판정 — 회전 판정과 **동시에** 돌린다. 같은 동작 한 번으로 두 방식의 효율을 비교해야
 * 방식 선택이 한 번에 끝난다(2026-07-29: 회전 판정이 53~64%에서 안 올라가 대안을 붙였다).
 */
const pumpCfg = reactive({ ...DEFAULT_PUMP })
const pump = createPump(pumpCfg)
const pumpOut = reactive({ rate: 0, revs: 0, active: false, ampPx: 0, avgRate: 0, sec: 0 })

/**
 * 지속 속도(왕복/s) — 첫 반주기부터 마지막 반주기까지의 구간으로 낸다.
 *
 * feed의 rate는 마지막 반주기 간격의 역수라 **순간값**이다. 2026-07-29 실측에서 y왕복이
 * 순간 1.28/s로 찍혔는데 어종표를 잡을 때 쓴 지속 속도는 0.37~0.63이었다 — 두 숫자가
 * 3배 차이인데 화면에는 순간값만 보여서 어느 쪽인지 알 수가 없었다. 밸런스는 지속 속도로
 * 정해지므로 그쪽을 화면의 주 숫자로 올린다.
 *
 * 구간 안의 반주기 간격은 halves-1개다(양 끝이 시각이라 간격이 하나 적다).
 */
function sustained(d: { halves: number; firstTick: number; lastTick: number }) {
  const sec = (d.lastTick - d.firstTick) / 1000
  // halves 3 미만이면 구간이 한 개도 안 나온다
  if (d.halves < 3 || sec <= 0) return { rate: 0, sec: 0 }
  return { rate: (d.halves - 1) / 2 / sec, sec }
}

/**
 * 양손 신호 실측 — 판정을 "손목 y 하나"에서 **양손 상대값**으로 옮기는 재설계의 검증용
 * (2026-07-29 논의). 세 판정이 전부 손목 y라서 게임이 "손을 위아래로 흔들기" 하나가 됐고,
 * px 문턱들이 전부 화각·체격에 의존한다. 양손 상대값은 둘 다 같은 깊이 평면에 있어
 * z 투영 문제가 상쇄되고, 차이값이라 체격·앉은 거리에 무관하다.
 *
 * 확인해야 하는 것 4개 — 이 숫자가 나오기 전에 판정기를 다시 짜면 회전 판정 때의 실수를
 * 반복한다:
 *   ① 양손이 노트북 화각에 동시에 들어오는가 → 미검출 프레임
 *   ② 양손을 잇는 선(=로드)의 각도가 파워 게이지로 쓸 만큼 넓게 움직이는가 → 각도 범위
 *   ③ 양손 사이 거리 왕복이 손목 y 왕복보다 빠른가 → rate 직접 비교 (핵심)
 *   ④ MediaPipe가 좌우 손목을 뒤집는가 → 스왑 의심 프레임
 *
 * ③은 pump.ts를 그대로 재사용한다 — 슈미트 트리거는 스칼라 하나만 받으므로 입력을
 * 손목 y에서 양손 거리로 바꾸면 끝이다. 진폭 문턱만 작은 동작에 맞춰 낮춘다(90 → 30):
 * 이 방식의 기대 효과가 "작은 동작으로 빠르게"라 90px을 요구하면 전제가 무너진다.
 */
const twoCfg = reactive({ ...DEFAULT_PUMP, minAmpPx: 30 })
const twoPump = createPump(twoCfg)
const two = reactive({
  visible: false,
  /** 양손 사이 거리(px) */
  distPx: 0,
  /** 로드 각도(deg) — 양손을 잇는 선의 기울기. 0 = 수평 */
  angleDeg: 0,
  /** 관측된 각도 범위 — 넓어야 파워 게이지가 성립한다 */
  angleMin: 999,
  angleMax: -999,
  /** 양손 중점 x — 조준에 쓸 값. 한 손의 흔들림이 평균으로 상쇄된다 */
  midX: 0,
  /** 거리 왕복 — pump.ts 재사용 */
  rate: 0,
  revs: 0,
  ampPx: 0,
  /** 지속 속도(왕복/s)와 그 구간 길이(초) — 결정에 쓰는 숫자는 이쪽이다 */
  avgRate: 0,
  sec: 0,
  /** 양손 중 하나라도 못 본 프레임 — 누적 */
  lost: 0,
  /**
   * 미검출률(%) — 최근 500ms 창.
   *
   * 누적 프레임만 보여줬더니 판단에 쓸 수 없었다(2026-07-29): 손 내리고 있던 시간이 전부
   * 섞여서 "488f"가 화각 문제인지 그냥 쉰 건지 구분이 안 됐다. 비율로 낸다.
   */
  lostPct: 0,
  /**
   * 관측된 미검출률 최솟값 — "양손을 제대로 들고 있을 때" 값이다.
   *
   * 창 값만으로는 여전히 못 믿는다: `측정값 복사`를 누르려면 손이 마우스로 나가야 해서
   * 마지막 창은 항상 오염된다(2026-07-29에 손실=100%로 찍힌 이유). 최솟값은 그 영향을 안 받는다.
   */
  lostPctMin: 100,
  /** 좌우 스왑 의심 프레임 */
  swaps: 0,
})
/** 40°는 파워 게이지를 5단계로 나눌 수 있는 최소치 — 이보다 좁으면 각도 방식이 안 된다 */
const angleSpan = computed(() =>
  two.angleMax > two.angleMin ? Math.round(two.angleMax - two.angleMin) : 0,
)

/**
 * 활성 판정 — 실제 게임에서 캐스팅과 릴 감기는 **동시에 존재하지 않는 페이즈**다
 * (찌를 던지기 전 vs 물고기가 걸린 뒤). 둘 다 손목 y의 빠른 하향을 쓰기 때문에 동시에
 * 돌리면 릴 감기가 캐스팅을 발사시킨다(2026-07-29 실기: 릴만 감았는데 3회 오발).
 * 랩도 게임과 같게 하나만 활성화한다 — 그래야 측정값이 게임에서의 값과 같다.
 */
const activeJudge = ref<'cast' | 'reel'>('reel')

/** 캐스팅 판정 (기획 §낚싯대 던지기) — 젖힘(손목이 어깨 위 유지) → 릴리즈(빠른 하향) */
const castCfg = reactive({ ...DEFAULT_CAST })
const cast = createCast(castCfg)
const castOut = reactive({
  phase: 'idle' as CastPhase,
  aimX: null as number | null,
  downVel: 0,
  /** 젖힘 최고점에서 내려온 거리(px) — 최소 낙하 조건 확인용 */
  dropPx: 0,
  /** 발사 횟수 — 오발이 나는지 세어본다 */
  fires: 0,
  lastAim: 0,
  /** 마지막 발사의 거리 0~1 (스윙 최고 속도 기준) */
  lastPower: 0,
})

/** 힘겨루기 — pump.rate로 굴린다(카운트가 아니라 속도). 어종을 골라 실기 밸런스를 본다 */
const fishIdx = ref(2)
const fight = createFight(FISH[fishIdx.value]!)
const fightOut = reactive({
  progress: 0,
  reeling: false,
  state: 'fighting' as FightState,
  grace: false,
})
/** 이번 물고기를 잡는 데 실제로 걸린 시간(초) — 어종표 확정의 근거 */
const fightSec = ref(0)
let fightRunning = false

function pickFish(i: number) {
  fishIdx.value = i
  fight.reset(FISH[i]!)
  Object.assign(fightOut, { progress: 0, reeling: false, state: 'fighting', grace: false })
  fightSec.value = 0
  fightRunning = true
}

/**
 * 측정값 한 줄 요약 — 랩 화면을 통째로 긁어 붙이는 대신 필요한 숫자만 모아 복사한다.
 * 화면 전체를 붙이면 읽는 쪽이 관계없는 안내문까지 다 뒤져야 해서 실제로 느렸다.
 */
function snapshotText(): string {
  const f = FISH[fishIdx.value]!
  const n = (v: number, d = 2) => v.toFixed(d)
  return [
    `[낚시랩] 페이즈=${activeJudge.value === 'reel' ? '릴감기' : '캐스팅'} 손=${handSide.value === 'right' ? '오른손' : '왼손'} 기준바퀴=${targetLaps.value}`,
    `펌핑: ${n(pumpOut.revs)}왕복 (${pumpEffPct.value}%) 지속=${n(pumpOut.avgRate)}/s (${n(pumpOut.sec, 1)}s 구간) 순간=${n(pumpOut.rate)} 진폭=${Math.round(pumpOut.ampPx)}px`,
    `회전: ${n(out.revs)}바퀴 (${effPct.value}%) rate=${n(out.rate)} 연속=${out.runLen} 추적=${fitReason.value}`,
    `양손: 지속=${n(two.avgRate)}/s vs y지속=${n(pumpOut.avgRate)}/s | 구간=${n(two.sec, 1)}s 순간=${n(two.rate)} 거리=${Math.round(two.distPx)}px 진폭=${Math.round(two.ampPx)}px`,
    `양손각도: ${n(two.angleDeg, 1)}° 범위=${angleSpan.value}° 중점x=${Math.round(two.midX)} 미검출=최저${two.lostPctMin}%/현재${two.lostPct}%(${two.lost}f) 스왑=${two.swaps}f`,
    `힘겨루기: ${f.name} ${fightOut.state} ${n(fightSec.value, 1)}s (이론 ${n(idealCatchSeconds(f), 1)}s / 목표 ${f.targetSec}s) 요구=${n(f.requiredRate)} 현재=${n(pumpOut.rate)}`,
    `캐스팅: 발사=${castOut.fires}회 하향=${Math.round(castOut.downVel)}px/s 낙하=${Math.round(castOut.dropPx)}px 거리=${n(castOut.lastPower)} 단계=${castOut.phase}`,
    `지표: fps=${m.fps}(최저${m.fpsMin}) 추론=${m.inferMs}ms 손실=${m.lossPct}% vis=${m.visMin} 가장자리=${m.edgeMin} 이탈=${m.outOfSafe}f`,
    `튜닝(릴): 섹터=${cfg.sectors} 밴드=${cfg.band} 창=${cfg.windowMs} 점프=${cfg.maxStep} 런=${cfg.minRun} 관용=${cfg.flipTolerance} 진폭문턱=${pumpCfg.minAmpPx}`,
    `튜닝(궤도): 추종=${fitCfg.smooth} 창=${fitCfg.windowMs} 반경=${trackR.value} 종횡=${trackAspect.value} 자동추적=${autoTrack.value}`,
    `튜닝(캐스팅): 여유=${castCfg.raiseMarginPx} 릴리즈문턱=${castCfg.releaseVelPxS} 최소낙하=${castCfg.minDropPx} 유지=${castCfg.holdMs}`,
  ].join('\n')
}

const copied = ref(false)
async function copySnapshot() {
  try {
    await navigator.clipboard.writeText(snapshotText())
  } catch {
    // 클립보드 권한이 없는 환경 — 텍스트박스로 대체해서 직접 긁을 수 있게 한다
    showSnapshot.value = true
    return
  }
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

/** 클립보드가 막혔을 때 보여주는 원문 — 직접 선택해서 복사한다 */
const showSnapshot = ref(false)
const snapshotForBox = ref('')
function toggleSnapshotBox() {
  snapshotForBox.value = snapshotText()
  showSnapshot.value = !showSnapshot.value
}

/** 효율 측정 기준 — "리셋 후 이만큼 돌린다"고 정해두면 효율이 화면에 바로 나온다 */
const targetLaps = ref(10)
const effPct = computed(() =>
  targetLaps.value > 0 ? Math.round((out.revs / targetLaps.value) * 100) : 0,
)
const pumpEffPct = computed(() =>
  targetLaps.value > 0 ? Math.round((pumpOut.revs / targetLaps.value) * 100) : 0,
)

/** 자동 맞춤(1회) — 손 궤적을 모아 중심·장단축을 역산한다 */
const fitting = ref(false)
const fitCount = ref(0)
let fitSamples: { x: number; y: number }[] = []
/** 이상치를 자르기 위한 백분위 — 5~95% 구간만 궤적으로 인정 */
const FIT_TRIM = 0.05
/** 자동 맞춤에 최소로 필요한 샘플 수 (30fps에서 약 2초) */
const FIT_MIN = 60

const pose = usePoseLandmarker()
const videoRef = ref<HTMLVideoElement>()
const canvasRef = ref<HTMLCanvasElement>()

const camError = ref<string | null>(null)
const loadProgress = ref(0)

/** 판정 결과 — 화면 표시용 */
const out = reactive({
  rate: 0,
  revs: 0,
  onTrack: false,
  dir: 0,
  runLen: 0,
  progress: 0,
  laps: 0,
  sector: -1,
})

/** 측정 지표 — 위 판단 목표 ①②③ */
const m = reactive({
  fps: 0,
  fpsMin: 0,
  inferMs: '–',
  /** 최근 창에서 손목을 놓친 프레임 비율(%) */
  lossPct: 0,
  /** 손목 visibility 최근 최솟값 */
  visMin: '–',
  /** 손이 안전 영역을 벗어난 누적 프레임 */
  outOfSafe: 0,
  /** 손이 도달한 화면 가장자리 최근접 비율(0=가장자리, 0.5=중앙) */
  edgeMin: '–',
})

const statusText = computed(() => {
  if (camError.value) return camError.value
  if (pose.error.value) return pose.error.value
  if (pose.isLoading.value) return `포즈 모델 로딩 중… ${Math.round(loadProgress.value * 100)}%`
  if (fitting.value) return `궤도 자동 맞춤 중 — 실제 릴 돌리듯 계속 돌려주세요 (${fitCount.value})`
  if (autoTrack.value) {
    // 자동 추적은 궤도를 맞춰주므로 "궤도를 벗어났다"가 아니라 "회전으로 안 보인다"가 맞다
    if (fitReason.value === 'few') return '손을 보여주고 릴 돌리듯 돌려주세요'
    if (fitReason.value === 'still') return '손이 멈춰 있어요 — 돌려주세요'
    if (fitReason.value === 'line') return '직선 왕복은 회전으로 안 봐요 — 원을 그리듯 돌려주세요'
    return out.onTrack ? '회전 인식 중 — 감기고 있어요' : '루프를 찾는 중…'
  }
  if (!out.onTrack && out.sector < 0) return '손을 궤도 위에 올리고 한 방향으로 돌려보세요'
  return out.onTrack ? '궤도 위 — 감기 인정 중' : '궤도를 벗어났어요'
})

let reel: Reel | null = null
let stream: MediaStream | null = null
let statsTimer = 0
let rafId = 0

/** 궤도 중심(캔버스 px) — 기본은 오른손이 편한 위치, 버튼으로 현재 손 위치에 스냅 */
const track = { cx: W * 0.68, cy: H * 0.55 }
/** 마지막 손 위치(캔버스 px) — null = 못 봄 */
let hand: { x: number; y: number } | null = null

/** 직전 포즈 프레임 시각 — 힘겨루기 게이지의 dt 계산용 */
let lastPoseT = 0

// 500ms 창 집계용 카운터
let frames = 0
let lostFrames = 0
let inferSum = 0
let visMinWin = 1
let edgeMinWin = 0.5
/** 500ms 창에서 양손 중 하나라도 못 본 프레임 수 */
let twoLostWin = 0

/** 세로 반경(장축) px */
function ryPx() {
  return trackR.value * H
}
/** 가로 반경(단축) px */
function rxPx() {
  return trackR.value * H * trackAspect.value
}

function onPose(result: PoseLandmarkerResult, inferenceMs: number) {
  frames++
  inferSum += inferenceMs

  const lm = result.landmarks?.[0]

  // 양손 신호 — 주 손목을 놓쳐도 계속 재도록 단일 손목 판정보다 **앞에서** 처리한다.
  // "양손이 다 보이는가"가 첫 번째 미지수라, 한 손이 사라지는 프레임이 측정 대상이다.
  const wl = lm?.[WRIST.left]
  const wr = lm?.[WRIST.right]
  if (wl && wr && (wl.visibility ?? 0) >= VIS_MIN && (wr.visibility ?? 0) >= VIS_MIN) {
    // 거울 좌표로 잰다 — 화면에 보이는 대로여야 숫자와 유저 체감이 일치한다
    const lx = (1 - wl.x) * W
    const ly = wl.y * H
    const rx = (1 - wr.x) * W
    const ry = wr.y * H
    two.visible = true
    two.distPx = Math.hypot(rx - lx, ry - ly)
    two.midX = (lx + rx) / 2
    two.angleDeg = (Math.atan2(ry - ly, rx - lx) * 180) / Math.PI
    two.angleMin = Math.min(two.angleMin, two.angleDeg)
    two.angleMax = Math.max(two.angleMax, two.angleDeg)
    // 거울 화면에서 유저의 왼손은 화면 왼쪽(작은 x)에 찍힌다 — 뒤집혔으면 스왑을 의심한다.
    // 손을 교차하면 정상적으로도 올라가므로 "0이어야 한다"가 아니라 추세만 본다.
    if (lx > rx) two.swaps++
    const t = twoPump.feed(two.distPx, performance.now())
    two.rate = t.rate
    two.revs = t.revs
    const td = twoPump.debug()
    two.ampPx = td.ampPx
    const ts = sustained(td)
    two.avgRate = ts.rate
    two.sec = ts.sec
  } else {
    two.visible = false
    two.lost++
    twoLostWin++
  }

  const w = lm?.[WRIST[handSide.value]]
  const vis = w?.visibility ?? 0
  if (!w || vis < VIS_MIN) {
    lostFrames++
    hand = null
    return
  }
  visMinWin = Math.min(visMinWin, vis)

  // 거울 표시 — MediaPipe x는 원본 카메라 이미지 기준이라 좌우를 뒤집어 그린다
  const x = (1 - w.x) * W
  const y = w.y * H
  hand = { x, y }

  // 프레임 여유: 가장자리까지의 거리를 정규화 비율로. 0에 가까울수록 프레임 이탈 직전
  const edge = Math.min(w.x, 1 - w.x, w.y, 1 - w.y)
  edgeMinWin = Math.min(edgeMinWin, edge)
  if (edge < SAFE_INSET) m.outOfSafe++

  if (fitting.value) {
    fitSamples.push({ x, y })
    fitCount.value = fitSamples.length
  }

  if (!reel) reel = createReel(track.cx, track.cy, rxPx(), ryPx(), cfg)

  // 자동 추적 — 손이 그리는 루프를 찾아 궤도를 매 프레임 맞춘다. 위상을 유지해야 하므로
  // moveTrack이 아니라 followTrack이다(moveTrack은 섹터 기준을 끊어 아무것도 세지 않는다).
  if (autoTrack.value) {
    fittedLoop = fitter.push(x, y, performance.now())
    fitReason.value = fitter.reason()
    if (fittedLoop) {
      reel.followTrack(fittedLoop.cx, fittedLoop.cy, fittedLoop.rx, fittedLoop.ry)
    }
  }

  const s = reel.feed(x, y, performance.now())
  out.rate = s.rate
  out.revs = s.revs
  out.onTrack = s.onTrack
  Object.assign(out, reel.debug())

  // 펌핑 판정 — y만 먹인다. x가 필요 없다는 게 이 방식의 핵심이다.
  const now = performance.now()
  const p = pump.feed(y, now)
  pumpOut.rate = p.rate
  pumpOut.revs = p.revs
  pumpOut.active = p.active
  const pd = pump.debug()
  pumpOut.ampPx = pd.ampPx
  const ps = sustained(pd)
  pumpOut.avgRate = ps.rate
  pumpOut.sec = ps.sec

  // 캐스팅 판정 — 같은 쪽 어깨 y를 기준으로 젖힘을 본다. 릴 감기 페이즈에서는 돌리지 않는다.
  const sh = lm?.[SHOULDER[handSide.value]]
  if (sh && activeJudge.value === 'cast') {
    const c = cast.feed(x, y, sh.y * H, now)
    castOut.phase = c.phase
    castOut.aimX = c.aimX
    castOut.downVel = c.downVelPxS
    castOut.dropPx = c.dropPx
    if (c.fired !== null) {
      castOut.fires++
      castOut.lastAim = c.firedAimX
      castOut.lastPower = c.fired
    }
  }

  // 힘겨루기 — 진행도를 카운트가 아니라 pump.rate로 굴린다
  const dtSec = lastPoseT ? Math.min((now - lastPoseT) / 1000, 0.1) : 0
  lastPoseT = now
  if (fightRunning && dtSec > 0 && activeJudge.value === 'reel') {
    const f = fight.step(p.rate, dtSec)
    Object.assign(fightOut, f)
    if (f.state === 'fighting') fightSec.value += dtSec
    else fightRunning = false
  }
}

function flushStats() {
  m.fps = frames * 2 // 500ms 창 → ×2
  if (m.fps > 0) m.fpsMin = m.fpsMin === 0 ? m.fps : Math.min(m.fpsMin, m.fps)
  m.inferMs = frames ? (inferSum / frames).toFixed(1) : '–'
  m.lossPct = frames ? Math.round((lostFrames / frames) * 100) : 0
  m.visMin = visMinWin < 1 ? visMinWin.toFixed(2) : '–'
  m.edgeMin = edgeMinWin < 0.5 ? edgeMinWin.toFixed(3) : '–'
  if (frames) {
    two.lostPct = Math.round((twoLostWin / frames) * 100)
    two.lostPctMin = Math.min(two.lostPctMin, two.lostPct)
  }
  frames = 0
  lostFrames = 0
  inferSum = 0
  visMinWin = 1
  edgeMinWin = 0.5
  twoLostWin = 0
}

/** 슬라이더가 바뀌면 궤도 형태를 갱신한다. cfg는 참조 공유라 즉시 반영된다 */
function applyTrack() {
  reel?.moveTrack(track.cx, track.cy, rxPx(), ryPx())
}

function snapTrackToHand() {
  if (!hand) return
  track.cx = hand.x
  track.cy = hand.y
  applyTrack()
}

function resetAll() {
  reel = createReel(track.cx, track.cy, rxPx(), ryPx(), cfg)
  pump.reset()
  Object.assign(pumpOut, { rate: 0, revs: 0, active: false, ampPx: 0, avgRate: 0, sec: 0 })
  twoPump.reset()
  twoLostWin = 0
  Object.assign(two, {
    visible: false,
    distPx: 0,
    angleDeg: 0,
    angleMin: 999,
    angleMax: -999,
    midX: 0,
    rate: 0,
    revs: 0,
    ampPx: 0,
    avgRate: 0,
    sec: 0,
    lost: 0,
    lostPct: 0,
    lostPctMin: 100,
    swaps: 0,
  })
  cast.reset()
  Object.assign(castOut, { phase: 'idle', aimX: null, downVel: 0, dropPx: 0, fires: 0, lastAim: 0, lastPower: 0 })
  fight.reset(FISH[fishIdx.value]!)
  Object.assign(fightOut, { progress: 0, reeling: false, state: 'fighting', grace: false })
  fightSec.value = 0
  fightRunning = false
  fitter.reset()
  fittedLoop = null
  fitReason.value = 'few'
  m.fpsMin = 0
  m.outOfSafe = 0
  Object.assign(out, { rate: 0, revs: 0, onTrack: false, dir: 0, runLen: 0, progress: 0, laps: 0, sector: -1 })
}

/** cfg(섹터·밴드 등)를 바꾸면 판정기를 새로 만든다 — 누적값을 섞으면 해석이 꼬인다 */
function rebuild() {
  reel = createReel(track.cx, track.cy, rxPx(), ryPx(), cfg)
}

/**
 * 궤도 자동 맞춤 — "평소처럼 릴 돌리듯" 몇 바퀴 돌린 궤적에서 중심·장단축을 역산한다.
 * 실제 크랭크 동작이 화면에 어떤 종횡비로 찍히는지가 이 게임의 핵심 미지수라, 사람이
 * 슬라이더로 맞추는 게 아니라 실제 동작에서 뽑아낸다.
 */
function toggleFit() {
  if (!fitting.value) {
    fitSamples = []
    fitCount.value = 0
    fitting.value = true
    return
  }
  fitting.value = false
  if (fitSamples.length < FIT_MIN) {
    camError.value = `샘플이 부족해요 (${fitSamples.length}/${FIT_MIN}) — 2초 이상 돌려주세요`
    setTimeout(() => (camError.value = null), 3000)
    return
  }
  // 백분위로 이상치를 자른다 — 손을 올리거나 내리는 구간이 장축을 부풀린다
  const span = (vals: number[]) => {
    const s = [...vals].sort((a, b) => a - b)
    const lo = s[Math.floor(s.length * FIT_TRIM)]!
    const hi = s[Math.min(s.length - 1, Math.floor(s.length * (1 - FIT_TRIM)))]!
    return { lo, hi, mid: (lo + hi) / 2, half: (hi - lo) / 2 }
  }
  const sx = span(fitSamples.map((p) => p.x))
  const sy = span(fitSamples.map((p) => p.y))
  // 장축을 세로로 고정한다 — 세로가 더 짧게 나오면 그건 크랭크가 아니라 좌우 왕복이다
  if (sy.half < 8) {
    camError.value = '세로 움직임이 거의 없어요 — 크랭크처럼 위아래로 도는 동작이 필요해요'
    setTimeout(() => (camError.value = null), 3500)
    return
  }
  track.cx = sx.mid
  track.cy = sy.mid
  trackR.value = sy.half / H
  trackAspect.value = Math.min(1, Math.max(0.1, sx.half / sy.half))
  rebuild()
}

function draw() {
  rafId = requestAnimationFrame(draw)
  const cv = canvasRef.value
  const video = videoRef.value
  if (!cv || !video) return
  const ctx = cv.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, W, H)

  // 캠 (거울)
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

  // 프레임 여유 가이드 (판단 목표 ②) — 이 밖으로 손이 나가면 곧 인식이 끊긴다
  ctx.save()
  ctx.strokeStyle = 'rgba(255,210,63,0.5)'
  ctx.setLineDash([6, 6])
  ctx.lineWidth = 1.5
  ctx.strokeRect(W * SAFE_INSET, H * SAFE_INSET, W * (1 - SAFE_INSET * 2), H * (1 - SAFE_INSET * 2))
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(255,210,63,0.75)'
  ctx.font = '10px monospace'
  ctx.fillText('안전 영역 — 밖으로 나가면 인식이 끊긴다', W * SAFE_INSET + 4, H * SAFE_INSET - 5)
  ctx.restore()

  drawTrack(ctx)
  drawHand(ctx)
}

function drawTrack(ctx: CanvasRenderingContext2D) {
  // 자동 추적이면 찾아낸 루프를 그린다 — 과녁이 아니라 "우리가 네 회전을 이렇게 본다"는 거울
  const useFit = autoTrack.value && fittedLoop !== null
  const cx = useFit ? fittedLoop!.cx : track.cx
  const cy = useFit ? fittedLoop!.cy : track.cy
  const rx = useFit ? fittedLoop!.rx : rxPx()
  const ry = useFit ? fittedLoop!.ry : ryPx()
  // 밴드는 정규화 공간에서 ±band라 화면 두께가 각도마다 다르다. 표시는 단축 기준으로
  // 근사한다 — 실제 판정은 reel.ts가 정규화 좌표로 정확히 한다.
  const band = Math.min(rx, ry) * cfg.band
  const TAU = Math.PI * 2

  // 링 밴드 — 이 안쪽이 "궤도 위"
  ctx.save()
  ctx.strokeStyle = out.onTrack ? 'rgba(198,255,94,0.18)' : 'rgba(147,161,201,0.14)'
  ctx.lineWidth = band * 2
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU)
  ctx.stroke()
  ctx.restore()

  // 섹터 호 + 현재 섹터 강조. 섹터는 정규화 공간의 각도로 나뉘므로 타원에서는
  // 화면 호 길이가 균일하지 않다 — 판정 기준과 화면이 일치하도록 이대로 그린다.
  const step = TAU / cfg.sectors
  for (let i = 0; i < cfg.sectors; i++) {
    const a0 = i * step
    const active = i === out.sector
    ctx.save()
    ctx.strokeStyle = active ? '#C6FF5E' : 'rgba(244,240,255,0.28)'
    ctx.lineWidth = active ? 4 : 1.5
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, a0 + step * 0.06, a0 + step * 0.94)
    ctx.stroke()
    ctx.restore()
  }

  // 이번 바퀴 진행도 — 중심에 원형 게이지
  ctx.save()
  ctx.strokeStyle = '#3ddcff'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(
    cx,
    cy,
    Math.min(rx, ry) * 0.34,
    -Math.PI / 2,
    -Math.PI / 2 + TAU * (out.progress / cfg.sectors),
  )
  ctx.stroke()
  ctx.fillStyle = 'rgba(244,240,255,0.9)'
  ctx.font = 'bold 15px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(String(out.laps), cx, cy + 5)
  ctx.restore()
}

function drawHand(ctx: CanvasRenderingContext2D) {
  if (!hand) return
  const color = out.onTrack ? '#C6FF5E' : '#FF5D73'
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = 14
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(hand.x, hand.y, 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

onMounted(async () => {
  reel = createReel(track.cx, track.cy, rxPx(), ryPx(), cfg)
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
      <h1>낚시 랩 <small>게임⑤ 릴 감기 판정 · S15P11A706-10</small></h1>
      <span class="status">{{ statusText }}</span>
      <div class="copybar">
        <button type="button" class="copy" @click="copySnapshot">
          {{ copied ? '복사됨 ✓' : '측정값 복사' }}
        </button>
        <button type="button" @click="toggleSnapshotBox">
          {{ showSnapshot ? '원문 닫기' : '원문 보기' }}
        </button>
      </div>
    </header>

    <textarea
      v-if="showSnapshot"
      class="snapbox"
      readonly
      rows="10"
      :value="snapshotForBox"
      @focus="(e) => (e.target as HTMLTextAreaElement).select()"
    />

    <div class="body">
      <div class="stage">
        <canvas ref="canvasRef" :width="W" :height="H" />
        <video ref="videoRef" playsinline muted class="hidden-video" />
      </div>

      <aside class="panel">
        <section class="verdict">
          <h2>방식 비교 — 실제 {{ targetLaps }}바퀴 기준</h2>
          <div class="cmp">
            <div :class="['box', effPct >= 90 ? 'win' : 'lose']">
              <div class="nm">회전 판정</div>
              <div class="pc">{{ effPct }}%</div>
              <div class="sub">{{ out.revs.toFixed(2) }}바퀴 · {{ out.rate.toFixed(2) }} rev/s</div>
            </div>
            <div :class="['box', pumpEffPct >= 90 ? 'win' : 'lose']">
              <div class="nm">펌핑 판정</div>
              <div class="pc">{{ pumpEffPct }}%</div>
              <div class="sub">
                {{ pumpOut.revs.toFixed(2) }}왕복 · {{ pumpOut.rate.toFixed(2) }} /s
              </div>
            </div>
          </div>
          <p class="hint">
            <b>리셋</b> → {{ targetLaps }}바퀴 돌리기 → 두 숫자 비교. 한 동작으로 동시에 측정된다.
            펌핑은 손목 y의 왕복만 보므로 궤도·중심·평면이 필요 없다.
          </p>
        </section>

        <section class="verdict">
          <h2>양손 신호 — 재설계 검증</h2>
          <div class="cmp">
            <div :class="['box', two.avgRate > pumpOut.avgRate ? 'win' : 'lose']">
              <div class="nm">양손 거리 왕복 · 지속</div>
              <div class="pc">{{ two.avgRate.toFixed(2) }}</div>
              <div class="sub">
                왕복/s · {{ two.sec.toFixed(1) }}s 구간 · 순간 {{ two.rate.toFixed(2) }} · 진폭
                {{ Math.round(two.ampPx) }}px
              </div>
            </div>
            <div :class="['box', pumpOut.avgRate >= two.avgRate ? 'win' : 'lose']">
              <div class="nm">손목 y 왕복 · 지속 (현행)</div>
              <div class="pc">{{ pumpOut.avgRate.toFixed(2) }}</div>
              <div class="sub">
                왕복/s · {{ pumpOut.sec.toFixed(1) }}s 구간 · 순간 {{ pumpOut.rate.toFixed(2) }} ·
                진폭 {{ Math.round(pumpOut.ampPx) }}px
              </div>
            </div>
          </div>
          <p class="hint">
            큰 숫자가 <b>지속 속도</b>(첫 반주기~마지막 반주기 구간 평균)다. 어종표 requiredRate는
            이 숫자로 정해야 한다 — 순간값은 3배까지 높게 찍힌다. <b>구간이 10s 이상</b> 쌓인
            값만 신뢰한다.
          </p>
          <dl>
            <dt>양손 인식</dt>
            <dd :class="two.visible ? 'ok' : 'bad'">
              {{ two.visible ? 'YES' : 'NO' }}
              <em>스왑 {{ two.swaps }}f</em>
            </dd>
            <dt>미검출률</dt>
            <dd :class="two.lostPctMin <= 5 ? 'ok' : 'bad'">
              최저 {{ two.lostPctMin }}<em
                >% / 현재 {{ two.lostPct }}% · 누적 {{ two.lost }}f · 5% 이하면 합격</em
              >
            </dd>
            <dt>로드 각도</dt>
            <dd>{{ two.angleDeg.toFixed(1) }} <em>°</em></dd>
            <dt>각도 범위</dt>
            <dd :class="angleSpan >= 40 ? 'ok' : 'bad'">
              {{ angleSpan }} <em>° 누적 / 40° 이상이면 파워 게이지 성립</em>
            </dd>
            <dt>양손 거리</dt>
            <dd class="big">{{ Math.round(two.distPx) }} <em>px</em></dd>
            <dt>중점 x (조준)</dt>
            <dd>{{ Math.round(two.midX) }}</dd>
          </dl>
          <p class="hint">
            <b>리셋</b> 후 순서대로 — ① 양손으로 막대 잡은 것처럼 들고 <b>손목을 당겼다 밀기</b>를
            <b>10초 이상</b> 쉬지 않고: 두 지속 속도를 비교해 왼쪽이 크면 릴 감기를 이걸로 바꾼다.
            ② 잡은 막대를 <b>기울여보기</b>: 각도 범위가 40°를 넘으면 파워를 속도 대신 각도로 잴
            수 있고, 그러면 게이지를 미리 보여줄 수 있다. ③ 그 동안 <b>미검출률 최저</b>가 5%를
            넘거나 스왑이 오르면 양손 전제 자체가 무너진다.
          </p>
        </section>

        <section>
          <h2>판정 결과</h2>
          <dl>
            <dt>회전 속도</dt>
            <dd class="big">{{ out.rate.toFixed(2) }} <em>rev/s</em></dd>
            <dt>누적 회전</dt>
            <dd class="big">{{ out.revs.toFixed(2) }} <em>바퀴</em></dd>
            <dt>펌핑 진폭</dt>
            <dd :class="pumpOut.active ? 'ok' : 'bad'">
              {{ Math.round(pumpOut.ampPx) }} <em>px / 문턱 {{ pumpCfg.minAmpPx }}</em>
            </dd>
            <dt>궤도 위</dt>
            <dd :class="out.onTrack ? 'ok' : 'bad'">{{ out.onTrack ? 'YES' : 'NO' }}</dd>
            <dt>방향 / 연속</dt>
            <dd>{{ out.dir > 0 ? '시계' : out.dir < 0 ? '반시계' : '–' }} / {{ out.runLen }}</dd>
            <dt>섹터</dt>
            <dd>{{ out.sector < 0 ? '끊김' : out.sector }}</dd>
            <dt>추적 상태</dt>
            <dd v-if="!autoTrack">고정 궤도</dd>
            <dd v-else :class="fitReason === 'ok' ? 'ok' : 'bad'">
              {{
                fitReason === 'ok'
                  ? '루프 추적 중'
                  : fitReason === 'still'
                    ? '정지'
                    : fitReason === 'line'
                      ? '직선 왕복'
                      : '샘플 부족'
              }}
            </dd>
          </dl>
        </section>

        <section>
          <h2>페이즈 — 한 번에 하나만</h2>
          <div class="btns mode">
            <button type="button" :class="{ active: activeJudge === 'cast' }" @click="activeJudge = 'cast'">
              캐스팅
            </button>
            <button type="button" :class="{ active: activeJudge === 'reel' }" @click="activeJudge = 'reel'">
              릴 감기
            </button>
          </div>
          <p class="hint">
            실제 게임에서 캐스팅(찌 던지기 전)과 릴 감기(물고기 걸린 뒤)는
            <b>동시에 존재하지 않는 페이즈</b>다. 둘 다 손목 y의 빠른 하향을 쓰기 때문에 동시에
            돌리면 릴 감기가 캐스팅을 발사시킨다(실기에서 릴만 감았는데 3회 오발). 게임과 같게
            하나만 켠다.
          </p>
        </section>

        <section :class="{ dim: activeJudge !== 'cast' }">
          <h2>캐스팅 (젖힘 → 내려꽂기)</h2>
          <dl>
            <dt>단계</dt>
            <dd :class="castOut.phase === 'armed' ? 'ok' : ''">
              {{
                castOut.phase === 'armed'
                  ? '조준 잠김 — 던지세요'
                  : castOut.phase === 'raising'
                    ? '젖히는 중…'
                    : '대기 (손목을 어깨 위로)'
              }}
            </dd>
            <dt>잠긴 조준 x</dt>
            <dd>{{ castOut.aimX === null ? '–' : Math.round(castOut.aimX) }}</dd>
            <dt>하향 속도</dt>
            <dd>{{ Math.round(castOut.downVel) }} <em>px/s / 문턱 {{ castCfg.releaseVelPxS }}</em></dd>
            <dt>발사</dt>
            <dd class="big">{{ castOut.fires }} <em>회</em></dd>
            <dt>낙하 거리</dt>
            <dd :class="castOut.dropPx >= castCfg.minDropPx ? 'ok' : ''">
              {{ Math.round(castOut.dropPx) }} <em>px / 필요 {{ castCfg.minDropPx }}</em>
            </dd>
            <dt>마지막 조준 x / 거리</dt>
            <dd>{{ Math.round(castOut.lastAim) }} / {{ castOut.lastPower.toFixed(2) }}</dd>
          </dl>
          <label>
            젖힘 여유 <output>{{ castCfg.raiseMarginPx }}px</output>
            <input v-model.number="castCfg.raiseMarginPx" type="range" min="0" max="90" step="5" />
          </label>
          <label>
            최소 낙하 거리 <output>{{ castCfg.minDropPx }}px</output>
            <input v-model.number="castCfg.minDropPx" type="range" min="40" max="240" step="10" />
          </label>
          <label>
            릴리즈 속도 문턱 <output>{{ castCfg.releaseVelPxS }}px/s</output>
            <input
              v-model.number="castCfg.releaseVelPxS"
              type="range"
              min="200"
              max="1500"
              step="50"
            />
          </label>
          <label>
            젖힘 유지 <output>{{ castCfg.holdMs }}ms</output>
            <input v-model.number="castCfg.holdMs" type="range" min="60" max="600" step="20" />
          </label>
          <p class="hint">
            손목을 어깨보다 위로 올려 잠깐 유지하면 <b>조준이 그 순간의 x로 잠긴다</b>(데모는
            발사 순간 위치를 조준으로 써서 조준이 작동하지 않았다). 그 뒤 빠르게 내려꽂으면 발사.
            천천히 내리면 발사되지 않는다.
          </p>
        </section>

        <section :class="{ dim: activeJudge !== 'reel' }">
          <h2>힘겨루기 — 속도로 굴린다</h2>
          <div class="btns">
            <button
              v-for="(f, i) in FISH"
              :key="f.name"
              type="button"
              :class="{ active: i === fishIdx }"
              @click="pickFish(i)"
            >
              {{ f.name }}
            </button>
          </div>
          <div class="gauge">
            <div
              class="fill"
              :class="{ danger: !fightOut.reeling }"
              :style="{ width: (fightOut.progress * 100).toFixed(1) + '%' }"
            />
          </div>
          <dl>
            <dt>상태</dt>
            <dd :class="fightOut.state === 'caught' ? 'ok' : fightOut.state === 'escaped' ? 'bad' : ''">
              {{
                fightOut.state === 'caught'
                  ? '낚았다!'
                  : fightOut.state === 'escaped'
                    ? '도망갔다…'
                    : fightOut.reeling
                      ? '감기고 있다'
                      : fightOut.grace
                        ? '준비 — 아직 저항 없음'
                        : 'DANGER — 더 빨리!'
              }}
            </dd>
            <dt>요구 / 현재 속도</dt>
            <dd :class="fightOut.reeling ? 'ok' : 'bad'">
              {{ FISH[fishIdx]!.requiredRate.toFixed(2) }} / {{ pumpOut.rate.toFixed(2) }}
            </dd>
            <dt>걸린 시간</dt>
            <dd>
              {{ fightSec.toFixed(1) }}
              <em>s / 목표 {{ FISH[fishIdx]!.targetSec }}s</em>
            </dd>
          </dl>
          <p class="hint">
            어종을 누르면 그 물고기와 싸움이 시작된다. <b>진행도는 누적 왕복이 아니라 현재 속도로
            찬다</b> — 사람마다 카운트가 90~115%로 편향돼도 결과가 안 뒤집히게 하는 게 목적이다.
            <b>걸린 시간</b>이 이론값과 비슷하면 어종표 숫자가 맞는 것이다.
          </p>
        </section>

        <section>
          <h2>실측 지표</h2>
          <dl>
            <dt>fps (최저)</dt>
            <dd :class="m.fps < 20 ? 'bad' : 'ok'">{{ m.fps }} <em>({{ m.fpsMin }})</em></dd>
            <dt>추론 시간</dt>
            <dd>{{ m.inferMs }} <em>ms</em></dd>
            <dt>손목 손실률</dt>
            <dd :class="m.lossPct > 10 ? 'bad' : 'ok'">{{ m.lossPct }}<em>%</em></dd>
            <dt>신뢰도 최저</dt>
            <dd>{{ m.visMin }}</dd>
            <dt>가장자리 최근접</dt>
            <dd :class="Number(m.edgeMin) < SAFE_INSET ? 'bad' : 'ok'">{{ m.edgeMin }}</dd>
            <dt>안전영역 이탈</dt>
            <dd>{{ m.outOfSafe }} <em>프레임</em></dd>
          </dl>
        </section>

        <section>
          <h2>궤도</h2>
          <div class="btns mode">
            <button type="button" :class="{ active: autoTrack }" @click="autoTrack = true">
              자동 추적
            </button>
            <button type="button" :class="{ active: !autoTrack }" @click="autoTrack = false">
              고정 궤도
            </button>
          </div>
          <p class="hint">
            <b>자동 추적</b> — 네가 돌리는 대로 궤도를 매 프레임 따라간다(권장).
            <b>고정 궤도</b> — 그려진 타원에 손을 맞춰야 한다. 아래 반경·종횡비 슬라이더는 고정 궤도에서만 쓴다.
          </p>
          <label>
            궤도 추종 속도 <output>{{ fitCfg.smooth.toFixed(2) }}</output>
            <input v-model.number="fitCfg.smooth" type="range" min="0.05" max="1" step="0.05" />
          </label>
          <label>
            추종 창 <output>{{ fitCfg.windowMs }}ms</output>
            <input v-model.number="fitCfg.windowMs" type="range" min="600" max="3000" step="100" />
          </label>
          <p class="hint">
            <b>궤도 추종 속도</b> — 1이면 필터 없이 즉시 따라간다. 낮으면 궤도가 손을 늦게 따라가
            중심이 루프 밖으로 밀리고, 그러면 각도가 회전이 아니라 진동으로 읽혀 효율이 떨어진다
            (실기 10바퀴에 6.38이 나온 원인).
          </p>
          <label>
            세로 반경(장축) <output>{{ trackR.toFixed(2) }}</output>
            <input v-model.number="trackR" type="range" min="0.08" max="0.32" step="0.01" @input="applyTrack" />
          </label>
          <label>
            종횡비(가로÷세로) <output>{{ trackAspect.toFixed(2) }}</output>
            <input
              v-model.number="trackAspect"
              type="range"
              min="0.1"
              max="1"
              step="0.02"
              @input="applyTrack"
            />
          </label>
          <div class="btns">
            <button type="button" :class="{ active: fitting }" @click="toggleFit">
              {{ fitting ? `맞춤 측정 중… ${fitCount}` : '궤도 자동 맞춤' }}
            </button>
            <button type="button" @click="snapTrackToHand">여기에 궤도 놓기</button>
            <button type="button" @click="handSide = handSide === 'right' ? 'left' : 'right'">
              {{ handSide === 'right' ? '오른손' : '왼손' }}
            </button>
            <button type="button" @click="resetAll">리셋</button>
          </div>
          <p class="hint">
            <b>자동 맞춤</b>을 누르고 실제 릴 돌리듯 3~4바퀴 돌린 뒤 다시 누르면, 그 궤적에 맞춰
            궤도가 타원으로 잡힌다. 종횡비 1 = 원.
          </p>
        </section>

        <section>
          <h2>판정 튜닝</h2>
          <label>
            섹터 수 <output>{{ cfg.sectors }}</output>
            <input v-model.number="cfg.sectors" type="range" min="4" max="16" step="1" @change="rebuild" />
          </label>
          <label>
            링 두께(밴드) <output>{{ cfg.band.toFixed(2) }}</output>
            <input v-model.number="cfg.band" type="range" min="0.15" max="0.8" step="0.05" @change="rebuild" />
          </label>
          <label>
            측정 창 <output>{{ cfg.windowMs }}ms</output>
            <input v-model.number="cfg.windowMs" type="range" min="300" max="1500" step="50" @change="rebuild" />
          </label>
          <label>
            최대 섹터 점프 <output>{{ cfg.maxStep }}</output>
            <input v-model.number="cfg.maxStep" type="range" min="1" max="4" step="1" @change="rebuild" />
          </label>
          <label>
            최소 연속 전이 <output>{{ cfg.minRun }}</output>
            <input v-model.number="cfg.minRun" type="range" min="1" max="6" step="1" @change="rebuild" />
          </label>
          <label>
            펌핑 진폭 문턱 <output>{{ pumpCfg.minAmpPx }}px</output>
            <input v-model.number="pumpCfg.minAmpPx" type="range" min="8" max="60" step="2" />
          </label>
          <label>
            역방향 관용 <output>{{ cfg.flipTolerance }}</output>
            <input
              v-model.number="cfg.flipTolerance"
              type="range"
              min="1"
              max="5"
              step="1"
              @change="rebuild"
            />
          </label>
          <p class="hint">
            <b>역방향 관용</b> — 되돌아가는 전이가 이 횟수 미만이면 지터로 보고 무시한다.
            1이면 한 프레임 지터에 진행도가 전부 날아간다(자동 추적이 53%로 떨어진 원인).
          </p>
          <p class="hint">
            검출 상한 = maxStep × fps ÷ 섹터 =
            <b>{{ ((cfg.maxStep * (m.fps || 30)) / cfg.sectors).toFixed(1) }} rev/s</b>
          </p>
        </section>

        <section>
          <h2>측정 순서</h2>
          <label>
            효율 기준 바퀴 수 <output>{{ targetLaps }}</output>
            <input v-model.number="targetLaps" type="range" min="3" max="20" step="1" />
          </label>
          <ol class="hint">
            <li><b>리셋</b> → 기준 바퀴 수만큼 돌리고 <b>효율</b>을 읽는다 (90% 이상이면 합격)</li>
            <li>효율이 낮으면 <b>궤도 추종 속도</b>를 올려가며(0.35 → 0.6 → 1.0) 다시 측정</li>
            <li>손을 밖으로 밀며 <b>가장자리 최근접</b>이 얼마일 때 끊기는지 본다</li>
            <li>불을 끄고 <b>fps 최저</b>를 본다</li>
            <li>좌우로 흔들어 <b>누적 회전이 안 오르는지</b> 확인한다</li>
          </ol>
        </section>
      </aside>
    </div>
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
  gap: 14px;
  flex-wrap: wrap;
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
.status {
  font-size: 12px;
  color: #c6ff5e;
}
.body {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  flex-wrap: wrap;
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
.panel {
  flex: 1 1 300px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
section {
  background: #152049;
  border: 1px solid rgba(244, 240, 255, 0.1);
  border-radius: 12px;
  padding: 12px 14px;
}
h2 {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #93a1c9;
  margin: 0 0 8px;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
  font-size: 12.5px;
}
dt {
  color: #93a1c9;
}
dd {
  margin: 0;
  font-family: ui-monospace, monospace;
  text-align: right;
}
dd.big {
  font-size: 15px;
  font-weight: 700;
}
dd em {
  font-size: 10px;
  color: #93a1c9;
  font-style: normal;
}
dd.ok {
  color: #c6ff5e;
}
dd.bad {
  color: #ff5d73;
}
label {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 4px 8px;
  font-size: 12px;
  color: #93a1c9;
  margin-bottom: 8px;
}
label input {
  grid-column: 1 / -1;
  width: 100%;
}
output {
  font-family: ui-monospace, monospace;
  color: #f4f0ff;
}
.btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.btns.mode {
  margin-bottom: 8px;
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
section.dim {
  opacity: 0.42;
}
.copybar {
  margin-left: auto;
  display: flex;
  gap: 6px;
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
.gauge {
  height: 16px;
  border-radius: 8px;
  background: #0d1128;
  border: 1px solid rgba(244, 240, 255, 0.14);
  overflow: hidden;
  margin: 8px 0;
}
.gauge .fill {
  height: 100%;
  background: linear-gradient(90deg, #8fe23f, #c6ff5e);
  transition: width 0.08s linear;
}
.gauge .fill.danger {
  background: linear-gradient(90deg, #ff8a5a, #ff3b5c);
}
.verdict .cmp {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.verdict .box {
  border-radius: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(244, 240, 255, 0.14);
  background: #1c2a5e;
}
.verdict .box.win {
  border-color: #c6ff5e;
  background: rgba(198, 255, 94, 0.12);
}
.verdict .box.lose {
  border-color: rgba(255, 93, 115, 0.5);
}
.verdict .nm {
  font-size: 11px;
  color: #93a1c9;
  letter-spacing: 0.06em;
}
.verdict .pc {
  font-family: ui-monospace, monospace;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
}
.verdict .box.win .pc {
  color: #c6ff5e;
}
.verdict .box.lose .pc {
  color: #ff5d73;
}
.verdict .sub {
  font-family: ui-monospace, monospace;
  font-size: 10.5px;
  color: #93a1c9;
}
button.active {
  background: #c6ff5e;
  color: #101a12;
  border-color: #c6ff5e;
  font-weight: 700;
}
.hint {
  font-size: 11.5px;
  color: #93a1c9;
  line-height: 1.6;
  margin: 0;
  padding-left: 1.1em;
}
.hint b {
  color: #f4f0ff;
}
p.hint {
  padding-left: 0;
}
</style>
