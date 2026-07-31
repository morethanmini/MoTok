<script setup lang="ts">
/**
 * 게임④ 몸 끼워 맞추기 — 인게임 화면 (기획 §6-3, S15P11A706-47).
 *
 * 모톡 UI 템플릿(tokens.css 픽셀 테마)을 따른다: 크림 배경·잉크 보더·하드섀도 카드,
 * 3D 무대는 뷰포트 카드 안쪽에만 어둡게 들어간다.
 *
 * 지금은 1인 로컬 루프(내 포즈 → 출제 → 내가 통과)로 동작한다 — 멀티(출제자 로테이션·
 * 서버 타이머)는 -86/-48에서 세션 이벤트에 연결한다. 화면 구성 요소(게이지·타이머·
 * 썸네일·접근 바·등급 팝업·캠 스켈레톤 PiP)는 멀티에서도 그대로 쓰인다.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { GameResultEntry } from '@/api/types'
import { usePoseLandmarker, type PoseLandmarkerResult } from '@/composables/usePoseLandmarker'
import type { ActiveGameSession } from '../session'
import { defaultConfig, type DifficultyKey, type Grade } from './config'
import { PoseSmoother } from './oneEuro'
import { AvatarRig, type SegmentKey } from './avatarRig'
import {
  createSkeletonState,
  normalizePose,
  solveSkeleton,
  type LandmarkPoint,
  type SolvedSkeleton,
} from './skeleton'
import { drawSilhouette } from './silhouette'
import { randomPose, type Rng } from './randomPose'
import { chainApproachMs, chainGapMs, seededRng } from './chainSchedule'
import {
  GRADE_POINTS,
  gradeOf as gradeFromIou,
  holeMarginFor,
  judgeRound,
  poseDifficulty,
  scoreFor,
  type RoundJudgment,
} from './judge'
import { createPoseThumb, createStage, type PoseThumb, type Stage } from './stage'
import { createWall, type WallHandle } from './wall'
import { BodyFitAudio } from './audio'
import EarnedPoints from '../EarnedPoints.vue'

const props = defineProps<{
  /** 게임룸 셀프 타일의 <video> — 있으면 카메라를 새로 열지 않고 재사용한다 (게임① 패턴) */
  video?: HTMLVideoElement | null
  /** 멀티플레이 세션(GAME_START). null이면 솔로 모드(개발 라우트) */
  session?: ActiveGameSession | null
  /** GAME_END 순위 — 도착 전까지 "집계 중" 표시 */
  results?: GameResultEntry[] | null
  myUserId?: string | null
  /** POSE_SET으로 도착한 출제 포즈(랜드마크 JSON) — 벽 생성 입력 */
  challenge?: string | null
  /**
   * 게임④(-9): 실시간 중계 — 부모의 scoreboardRows. 출제자 관전 화면과 연속 서바이벌
   * 순위 카드가 같은 배열을 쓴다. 연속 모드에서는 starsLit 자리에 콤보,
   * holdProgress 자리에 점수 진행률이 실려 온다(emitChainProgress 참고).
   */
  scores?: {
    userId: string
    nickname: string
    starsLit: number
    holdProgress: number
    finished: boolean
    score: number | null
  }[]
  /** 게임④(-9): 이번 라운드 출제자 표시명 — 누가 내는지/내 차례인지 화면에 박아준다 */
  setterName?: string | null
  /**
   * 게임룸 셀프 타일 안에 얹히는가(= 타일을 채우도록 absolute 배치).
   * 이전에는 isMultiplayer로 대신 판단했는데, 1인 방 연습 모드는 session이 null이라
   * 클래스가 안 붙어 100vh 블록이 되고 overflow:hidden 타일에 가려 화면에 안 보였다.
   * "방 안인가"와 "멀티인가"는 별개 조건이다.
   */
  embedded?: boolean
}>()
const emit = defineEmits<{
  close: []
  /** 멀티: 내가 출제자일 때 캡처한 포즈(랜드마크 JSON) → 부모가 STOMP 발신 */
  'pose-submit': [pose: string]
  /** 멀티: 실시간 일치율(4Hz) → 부모가 PROGRESS로 중계. 출제자 관전 화면의 입력이 된다 */
  progress: [starsLit: number, holdProgress: number]
  /** 멀티: 판정 확정 → 부모가 finish 발신. 솔로: 토스트용 */
  finished: [payload: { score: number; grade: Grade; iou: number }]
}>()

const cfg = reactive(defaultConfig())
const pose = usePoseLandmarker()
const isMultiplayer = computed(() => !!props.session)
const isSetter = computed(
  () => !!props.session?.setterUserId && props.session.setterUserId === props.myUserId,
)
/**
 * 연속 서바이벌(-9) — 서버가 정한 모드. 출제자·로테이션이 없고 전원이 동시에 뛴다.
 * chain(로컬 컨베이어 on/off)과 구분한다: 벽을 다 받으면 chain은 꺼지지만 세션은 아직 chainMode다.
 */
const chainMode = computed(() => props.session?.mode === 'chain')

const videoRef = ref<HTMLVideoElement>()
const glCanvasRef = ref<HTMLCanvasElement>()
const viewportRef = ref<HTMLDivElement>()
const pipOverlayRef = ref<HTMLCanvasElement>()
const thumbRef = ref<HTMLCanvasElement>()
/** 출제자 관전 화면의 큰 구멍 — 썸네일과 달리 "벽에 뚫린 구멍" 자체를 보여준다 */
const holeRef = ref<HTMLCanvasElement>()
const sideRef = ref<HTMLElement>()

/** stale = 벽 도착 후 다음 라운드 이벤트가 끊긴 상태(복구 대기) — 아래 STALE_MS 참고 */
type Phase = 'idle' | 'wait' | 'setting' | 'incoming' | 'result' | 'stale'
const phase = ref<Phase>('idle')
const round = ref(0)
const timerSec = ref(0)
const approachPct = ref(0)
const tracked = ref(false)
const camError = ref<string | null>(null)
const judgment = ref<RoundJudgment | null>(null)
/** 이번 라운드를 랜덤 출제로 만들었으면 그 원형 이름 — 사람이 낸 포즈면 null */
const randomPoseName = ref<string | null>(null)
/** 연속 랜덤 모드(솔로) — 벽이 끊이지 않고 이어진다. 멈추는 건 중지 버튼뿐이다 */
const chain = ref(false)
/** 연속 성공 콤보와 최고 기록 — 실패해도 모드는 계속되고 콤보만 0으로 돌아간다 */
const combo = ref(0)
const bestCombo = ref(0)
/** 연속 모드에서 벽 몇 장을 받을지. 0 = 무한(중지를 누를 때까지) */
const chainTarget = ref(10)
const CHAIN_TARGETS = [10, 20, 30, 0]
/** 아바타 평면에 닿은 벽 수 — 진행 표시(3/10)용 */
const chainArrived = ref(0)
/** 연속 모드가 끝난 뒤 한 줄 요약 — 다음 라운드를 시작하면 지워진다 */
const chainSummary = ref<string | null>(null)
/** 접근 중 실시간 판정(스로틀) — 게이지·빨강 세그먼트용 */
const liveIou = ref(0)
const totalScore = ref(0)
const finalScore = ref<number | null>(null)
const history = ref<{ round: number; grade: Grade; iou: number }[]>([])

const displayedFinalScore = computed(() => {
  if (finalScore.value !== null) return finalScore.value
  return props.results?.find((result) => result.userId === props.myUserId)?.score ?? null
})

function closeFinalResult() {
  finalScore.value = null
  emit('close')
}

const GRADE_COLOR: Record<Grade, string> = {
  PERFECT: 'var(--bf-violet)',
  GREAT: 'var(--bf-mint)',
  PASS: 'var(--bf-gold)',
  FAIL: 'var(--bf-coral)',
}
/** 관전 화면용 — 서버가 돌려준 점수를 등급으로 역산한다(GRADE_POINTS의 역함수).
 *  실패 점수는 FAIL_MAX_SCORE 이하라 어떤 등급 점수와도 겹치지 않는다(judge.ts 주석 참고). */
function gradeOf(score: number | null): Grade {
  return (Object.keys(GRADE_POINTS) as Grade[]).find((g) => GRADE_POINTS[g] === score) ?? 'FAIL'
}
/** 관전 화면 링 색 — 진행 중인 도전자의 실시간 일치율(0~1)을 등급 색으로 */
function liveGradeOf(holdProgress: number): Grade {
  return gradeFromIou(holdProgress * 100, cfg)
}

/** 삐져나온 신체 부위 안내(실기 피드백) — 어디가 안 맞는지 말로도 짚어준다 */
const SEGMENT_WARNING: Record<SegmentKey, string> = {
  head: '머리가 벽에 걸려요',
  torso: '몸통이 벽에 걸려요',
  upperL: '왼팔이 벽에 걸려요',
  foreL: '왼팔이 벽에 걸려요',
  handL: '왼손이 벽에 걸려요',
  upperR: '오른팔이 벽에 걸려요',
  foreR: '오른팔이 벽에 걸려요',
  handR: '오른손이 벽에 걸려요',
}
/** liveJudge/finalizeJudgment가 채우는 현재 삐져나온 세그먼트 — 경고 문구용 */
const liveOverflow = ref<SegmentKey[]>([])
const overflowWarning = computed(() =>
  liveOverflow.value.length ? SEGMENT_WARNING[liveOverflow.value[0]!] : null,
)
/**
 * FAIL 팝업에 붙일 실패 사유.
 * 탈락 경로가 둘이다 — ① 구멍 밖으로 삐져나옴(어느 부위인지 말해준다) ② 삐져나오진 않았지만
 * 모양이 너무 안 맞아 등급만 FAIL. 둘을 구분해줘야 "일치율 80인데 왜 실패냐"가 안 나온다.
 */
const failReason = computed(() => {
  if (judgment.value?.grade !== 'FAIL') return null
  return overflowWarning.value ?? '포즈가 많이 달라요'
})

const DIFFICULTIES: { key: DifficultyKey; label: string }[] = [
  { key: 'easy', label: '쉬움' },
  { key: 'normal', label: '보통' },
  { key: 'hard', label: '어려움' },
]
const difficulty = ref<DifficultyKey>('easy')

/** 난이도 = 구멍 여유(K) + 벽 속도. 다음 라운드부터 적용된다 */
function setDifficulty(key: DifficultyKey) {
  difficulty.value = key
  cfg.judge.K = cfg.difficulty[key].K
  cfg.wall.approachMs = cfg.difficulty[key].approachMs
}

/** 게임④(-9): 출제자는 포즈를 넘긴 뒤 뛰지 않는다 — 3D 무대 대신 관전 화면을 본다.
 * 씬에는 자기 아바타밖에 없어서 벽이 빈 무대로 날아오는 그림이 되기 때문(실기 피드백). */
const spectating = computed(
  () =>
    isMultiplayer.value &&
    isSetter.value &&
    (phase.value === 'incoming' || phase.value === 'result'),
)

/** 출제자 이름 — 서버가 setterUserId만 주므로 부모가 참가자 목록에서 찾아 내려준다 */
const setterLabel = computed(() => {
  if (!isMultiplayer.value) return '나 (솔로)'
  const name = props.setterName ?? '출제자'
  return isSetter.value ? `${name} (나!)` : name
})
/** 내가 지금 포즈를 내는 중 — 이때만 "내가 낸다"는 골드 표시를 크게 띄운다.
 * 휴식 구간은 제외한다 — 그쪽은 rest-panel이 따로 알려주고, 색을 겹치면 다시 구분이 안 된다. */
const myPoseTurn = computed(
  () => isMultiplayer.value && isSetter.value && phase.value === 'setting',
)
/** 첫 라운드 시작 전 대기 — 같은 'wait' 페이즈지만 "다음 차례"가 아니라 "첫 출제자"다 */
const firstWait = computed(() => (props.session?.roundNo ?? 1) <= 1)
/** 휴식 패널 본문 — 출제 카운트다운과 문구·크기·색을 전부 분리한다(같아 보여서 헷갈렸다) */
const restWho = computed(() => {
  if (!isMultiplayer.value) return '곧 시작합니다'
  if (isSetter.value) return firstWait.value ? '첫 출제자는 나!' : '다음 차례는 나!'
  const name = props.setterName ?? '출제자'
  return firstWait.value ? `${name}님이 첫 출제자입니다` : `${name}님 다음 차례입니다`
})
/**
 * 무대에서 아바타를 치우는 구간.
 * - 휴식: 전원 — 쉬는 시간에 아바타가 서 있으면 출제 페이즈와 화면이 구분되지 않는다.
 * - 관전: 출제자만 — 이미 spectating이 같은 조건을 들고 있다.
 */
const hideAvatar = computed(
  () => isMultiplayer.value && (phase.value === 'wait' || spectating.value),
)

/** 출제 카운트다운 위에 얹는 한 줄 — "지금 뭘 해야 하나"를 짚어준다 */
const countdownCaption = computed(() =>
  !isMultiplayer.value || isSetter.value
    ? '포즈를 취하세요!'
    : `${props.setterName ?? '출제자'}님이 출제 중`,
)

/** 게임④ 출제자 로테이션(-48): "N/전체" 라운드 표시 — 로테이션 없는 세션(솔로 등)은 숫자만 */
const totalRoundsLabel = computed(() =>
  isMultiplayer.value && props.session?.totalRounds ? `/${props.session.totalRounds}` : '',
)

const gaugeGrade = computed<Grade>(() => gradeFromIou(liveIou.value, cfg))

/** 원형 게이지 — 반지름 52, 둘레 기준 dashoffset */
const GAUGE_R = 52
const GAUGE_C = 2 * Math.PI * GAUGE_R
/** 관전 화면 도전자 링 — 40×40 viewBox 기준 */
const RING_R = 16
const RING_C = 2 * Math.PI * RING_R
const gaugeOffset = computed(() => GAUGE_C * (1 - Math.min(liveIou.value, 100) / 100))
const gaugeTicks = computed(() => [
  { pct: cfg.judge.grade.pass, label: 'PASS' },
  { pct: cfg.judge.grade.great, label: 'GREAT' },
  { pct: cfg.judge.grade.perfect, label: 'PERFECT' },
])

// ── three.js / 게임 상태 (비반응형) ──
let stage: Stage | null = null
let thumb: PoseThumb | null = null
let rig: AvatarRig
let wall: WallHandle
let rafId = 0
/** rAF가 멈추는 창(숨김·가림)에서도 페이즈가 진행되도록 하는 백업 시계 — onMounted 참고 */
let phaseTimerId = 0
let resizeObs: ResizeObserver | null = null
let stream: MediaStream | null = null
const smoother = new PoseSmoother(cfg.filter)

let setterPose: SolvedSkeleton | null = null
let holeMargin = 0
let captureAt = 0
let approachStart = 0
let resultAt = 0
let lastLiveJudge = 0
// -12에서 시작하면 접근 시간의 대부분을 안개(fog far=18) 속 먼 거리에 있다가 easeIn 곡선
// 막판에만 훅 커져서, 그동안은 화면을 채운 아바타에 가려 구멍 모양이 거의 안 보였다(실기 피드백).
// -6으로 당겨 더 일찍·더 크게 보이게 한다.
const WALL_START_Z = -6
/** 벽이 아바타(z=0)와 같은 깊이까지 오면 평면이 3D 아바타 몸통을 그대로 관통해 실루엣이
 * 안 보인다 — 판정은 2D 마스크라 3D 정지 위치와 무관하니, 살짝 앞에서 멈춰 겹침을 피한다. */
const WALL_STOP_Z = -1

// ── 멀티 라운드 상태 (서버 타임라인 기반, -86) ──
/** 출제 페이즈 길이 — 서버 BODY_FIT_SETTING_MILLIS와 동기화 */
const SETTING_MS = 5000
/**
 * 벽 도착(endAt) 후 다음 라운드 이벤트를 기다리는 한계.
 * 서버는 늦어도 endAt + END_GRACE(1.5s)에 정산하고 곧바로 다음 GAME_START(휴식 6s 포함)를
 * 쏘므로, 이 시간을 넘겼으면 그 프레임을 못 받은 것이다.
 */
const STALE_MS = 5000
/** 필터 통과된 마지막 랜드마크 — 출제 캡처(전송) 원본 */
let lastSmoothed: LandmarkPoint[] | null = null
let poseSubmitted = false
let finishedSent = false

/** 멀티: 서버 보정 시각 (게임① 패턴) */
function serverNow(): number {
  return Date.now() + (props.session?.clockOffset ?? 0)
}

/** 랜드마크 → 전송 포맷: [[x,y,z,visibility]×33], 소수 4자리 (~2KB, §9-2) */
function serializePose(lm: LandmarkPoint[]): string {
  const r = (v: number) => Math.round(v * 10000) / 10000
  return JSON.stringify(lm.map((p) => [r(p.x), r(p.y), r(p.z ?? 0), r(p.visibility ?? 0)]))
}

function parsePose(json: string): LandmarkPoint[] {
  const raw = JSON.parse(json) as number[][]
  return raw.map((p) => ({ x: p[0] ?? 0, y: p[1] ?? 0, z: p[2], visibility: p[3] }))
}

function applyDifficulty(key: string | null | undefined) {
  const k = (key ?? 'easy') as DifficultyKey
  if (cfg.difficulty[k]) setDifficulty(k)
}
/** 캠 PiP 스켈레톤 연결선 (상반신 + 힙 라인) */
const PIP_BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
]

function initThree(canvas: HTMLCanvasElement) {
  stage = createStage(canvas, cfg)
  thumb = createPoseThumb(thumbRef.value!, cfg.avatar)
  rig = new AvatarRig(cfg.avatar)
  stage.scene.add(rig.group)
  stage.setFloorY(rig.floorY)
  wall = createWall()
  stage.scene.add(wall.mesh)
}

/** 라운드 진행 중이면 새 라운드를 시작하지 않는다 */
const roundBusy = () => phase.value === 'setting' || phase.value === 'incoming'

function resetRoundState() {
  judgment.value = null
  liveIou.value = 0
  liveOverflow.value = []
  rig.setOverflow([])
  round.value += 1
}

function startRound() {
  if (!tracked.value || roundBusy()) return
  resetRoundState()
  randomPoseName.value = null
  captureAt = performance.now() + 3000
  phase.value = 'setting'
}

/**
 * 랜덤 출제(솔로 단발) — 코드가 만든 포즈를 그대로 벽으로 세운다.
 * 3초 카운트다운을 건너뛰는 이유: 사람이 포즈를 잡을 필요가 없으니 기다릴 게 없다.
 * 카메라는 여전히 필요하다 — 출제는 코드가 하지만 통과는 내가 해야 한다.
 */
function startRandomRound() {
  if (!tracked.value || roundBusy()) return
  const { name, landmarks } = randomPose()
  const solved = solveFromLandmarks(landmarks)
  if (!solved) return
  resetRoundState()
  randomPoseName.value = name
  armWall(solved)
  approachStart = performance.now()
  phase.value = 'incoming'
}

// ── 연속 모드: 벽 컨베이어 ─────────────────────────────────────────
/**
 * "끊김없이"의 뜻 — 한 장을 판정하고 다음 장을 만드는 게 아니라, 앞 벽이 아직 날아오는 중에
 * 다음 벽이 뒤에서 출발한다. 무대에는 항상 2~3장이 서로 다른 깊이에 떠 있고, 도착하는
 * 순서대로 하나씩 판정된다. 판정된 벽은 멈추지 않고 카메라를 지나쳐 나간다(멈추면 흐름이 끊긴다).
 *
 * <p>벽마다 구멍 텍스처가 달라서 메시 하나를 돌려쓸 수 없다. 그래서 핸들 풀을 두고 지나간 벽을
 * 반납받아 재사용한다 — 벽마다 캔버스 2장 + 텍스처 2장을 새로 만들면 GC가 프레임을 먹는다.
 * 풀은 연속 모드를 처음 켤 때 필요한 만큼만 만든다(안 쓰는 사람은 비용을 내지 않는다).</p>
 */
const POOL_MAX = 4
/** 접근 곡선이 지나는 거리 — 스폰 간격을 시간으로 환산할 때의 분모(chainSchedule) */
const WALL_SPAN_Z = WALL_STOP_Z - WALL_START_Z
/** 판정 팝업을 띄워두는 시간 — 다음 벽이 닿기 전에 지워야 새 판정으로 읽힌다 */
const POP_MS = 700
/** 마지막 판정의 등급·점수를 읽을 시간을 준 뒤 종료 화면을 띄운다. */
const FINAL_RESULT_DELAY_MS = 1200
/**
 * 판정된 벽이 빠져나가는 데 걸리는 시간. 이 동안 앞으로 밀면서 투명해지고, 끝나면 반납된다.
 *
 * <p>프레임당 일정 거리(예전 방식)로 밀면 느린 기기에서 더 오래 남는다 — 통과한 벽이 오래
 * 남으면 카메라에 가까워지며 화면을 덮어 <b>다음 벽 구멍을 미리 읽을 수 없다</b>(실기 피드백).
 * 시간 기준이면 어떤 기기에서도 같은 시간 안에 비켜준다. "지나갔다"는 신호는 판정 팝업(POP_MS)이
 * 이미 주므로 벽 자체는 빨리 사라져도 된다.</p>
 */
const FLY_AWAY_MS = 240
/**
 * 삭는 동안 앞으로 미는 거리 — 아주 짧다.
 * 예전처럼 카메라까지 밀어버리면 그 자체가 화면을 덮는다. 시야를 비우는 일은 디졸브가 하고,
 * 이 이동은 "지나갔다"는 방향감만 준다.
 */
const FLY_AWAY_Z = 0.6

interface FlyingWall {
  handle: WallHandle
  pose: SolvedSkeleton
  margin: number
  name: string
  start: number
  /** 이 벽 고유의 접근 시간 — 가속 중이라 벽마다 다르다 */
  approachMs: number
  judged: boolean
  /** 판정된 시각 — 빠져나가는 연출(FLY_AWAY_MS)의 기준점 */
  judgedAt: number
}
/** 반납된 재사용 대기 핸들 */
let pool: WallHandle[] = []
/** 지금까지 만든 핸들 수 — POOL_MAX까지만 늘린다 */
let poolCreated = 0
/** 날아오는 중인 벽 — 먼저 출발한 것이 앞(= 먼저 도착) */
let flying: FlyingWall[] = []
/** 연속 모드에서 지금까지 띄운 벽 수 — 가속 곡선의 지수 */
let chainSpawns = 0
/**
 * 다음 벽이 출발할 시각(rAF 시계). 스폰 시점에 미리 정해두고 그때가 오면 띄운다 —
 * 앞 벽의 z를 폴링하지 않으므로 프레임이 밀려도 스케줄이 밀리지 않는다.
 */
let chainNextStart = 0
/** 연속 모드 포즈 난수원 — 솔로는 undefined(Math.random). 방에서는 서버 시드 PRNG가 들어온다 */
let chainRng: Rng | undefined
let popAt = 0
let finalResultTimer = 0

function takeHandle(): WallHandle | null {
  const free = pool.pop()
  if (free) {
    // 삭던 중에 반납된 핸들(연속 모드 중지·새 세션)이 섞여 있다 — 되돌리지 않으면 다음 벽이
    // 구멍 뚫린 채로 뜬다. 재사용 경로가 여기 하나뿐이라 여기서만 정리한다.
    free.setDissolve(0)
    return free
  }
  if (poolCreated >= POOL_MAX || !stage) return null
  const handle = createWall()
  stage.scene.add(handle.mesh)
  poolCreated += 1
  return handle
}

/**
 * 새 벽 한 장을 무대 뒤편(WALL_START_Z)에 띄운다.
 *
 * <p>start는 실제로 띄운 시각(now)이 아니라 <b>스케줄이 정한 출발 시각</b>이다 — 풀이 비어
 * 한 틱 늦게 띄워도 위치가 스케줄에서 계산되므로 도착 시각이 밀리지 않는다(늦은 만큼 이미
 * 날아온 지점에서 나타난다). 방에서는 이 시각이 서버 startAt 기준이라 전원이 같은 벽을 본다.</p>
 */
function spawnChainWall(startAt: number) {
  const handle = takeHandle()
  if (!handle) return // 풀 고갈 — 다음 틱에 같은 startAt으로 다시 시도한다
  const { name, landmarks } = randomPose(undefined, chainRng)
  const pose = solveFromLandmarks(landmarks)
  if (!pose) {
    pool.push(handle)
    return
  }
  const margin = holeMarginFor(pose, cfg)
  handle.build(pose, margin, cfg)
  handle.mesh.position.z = WALL_START_Z
  handle.mesh.visible = true
  const base = cfg.difficulty[difficulty.value].approachMs
  flying.push({
    handle,
    pose,
    margin,
    name,
    start: startAt,
    approachMs: chainApproachMs(chainSpawns, base),
    judged: false,
    judgedAt: 0,
  })
  chainNextStart = startAt + chainGapMs(chainSpawns, base, WALL_SPAN_Z)
  chainSpawns += 1
}

/** 벽 하나가 아바타 평면에 닿은 순간 — 그 벽의 포즈로만 판정한다(다음 벽과 섞이면 안 된다) */
function judgeFlyingWall(w: FlyingWall, now: number) {
  w.judged = true
  w.judgedAt = now
  // 진행 카운트는 인식 여부와 무관하게 올린다 — 안 그러면 카메라가 끊긴 벽 하나 때문에
  // 진행률이 9/10에서 영원히 멈춘다(벽은 이미 지나갔는데)
  chainArrived.value += 1
  if (!rig.lastSolved) return
  const result = judgeRound(rig.lastSolved, w.pose, w.margin, cfg)
  judgment.value = result
  popAt = now
  liveIou.value = result.iou
  liveOverflow.value = result.overflow
  rig.setOverflow(result.overflow)
  totalScore.value += scoreFor(result)
  round.value += 1
  history.value.unshift({ round: round.value, grade: result.grade, iou: result.iou })
  if (result.passed) {
    combo.value += 1
    bestCombo.value = Math.max(bestCombo.value, combo.value)
  } else {
    combo.value = 0
  }
  emitChainProgress()
}

/**
 * 연속 서바이벌 중계 — 승부인데 끝나고서야 결과를 알면 재미의 절반이 날아간다.
 *
 * <p>PROGRESS 레일을 그대로 재사용한다(필드 추가 없음): starsLit 자리에 콤보, holdProgress
 * 자리에 점수 진행률. 점수는 벽이 판정될 때만 변하므로 4Hz로 보낼 필요가 없다 — 여기서만 보낸다.</p>
 */
function emitChainProgress() {
  if (!isMultiplayer.value || !chainMode.value) return
  emit('progress', combo.value, Math.min(1, totalScore.value / chainMaxScore.value))
}

/** 연속 서바이벌에서 이론상 받을 수 있는 만점 — 진행률 ↔ 점수 환산의 기준 */
const chainMaxScore = computed(() => (chainTarget.value || 1) * GRADE_POINTS.PERFECT)

/**
 * 서버에 제출하는 연속 서바이벌 점수 — 누적 총점이 아니라 <b>벽 1장당 평균</b>(0~100)이다.
 *
 * <p>총점을 그대로 보내면 안 된다. 서버가 그 값을 leaderboards.best_score(GREATEST)에 영속하고
 * PointCalculator(scoreBonus = score/10, 0~100 만점 전제)로 포인트를 지급하는데, 30벽이면
 * 3000점이 들어가 게임④ 멀티 랭킹이 <b>되돌릴 수 없게</b> 오염되고 포인트도 30배가 나간다.</p>
 *
 * <p>벽 수는 전원 같으므로 <b>평균 순위 = 총점 순위</b>다 — 승부 결과는 그대로고 눈금만 바뀐다.
 * 나눗셈의 분모는 받은 벽이 아니라 할당량이다(중간에 그만둔 사람이 평균으로 이득을 보면 안 된다).</p>
 */
const chainAverage = computed(() =>
  Math.round(totalScore.value / (chainTarget.value || 1)),
)

/**
 * 순위 카드에 쓸 점수 — 제출값과 같은 0~100 눈금으로 맞춘다.
 * 진행 중인 사람은 중계된 진행률(= 평균/100)을, 완주한 사람은 서버가 확정한 평균을 쓴다.
 */
function chainScoreOf(row: { holdProgress: number; finished: boolean; score: number | null }): number {
  return row.finished && row.score !== null ? row.score : row.holdProgress * GRADE_POINTS.PERFECT
}

/** 연속 서바이벌 실시간 순위 — 벽이 판정될 때마다 순서가 뒤집힌다 */
const chainRanking = computed(() =>
  [...(props.scores ?? [])].sort((a, b) => chainScoreOf(b) - chainScoreOf(a)),
)

/** 일반 라운드용 참가자 순위. 서버 확정 점수를 우선하고, 내 점수만 전송 전 로컬값을 보인다. */
const participantRanking = computed(() =>
  (props.scores ?? [])
    .map((row) => ({
      ...row,
      rankingScore: row.score ?? (row.userId === props.myUserId ? totalScore.value : 0),
    }))
    .sort((a, b) => b.rankingScore - a.rankingScore || a.nickname.localeCompare(b.nickname)),
)

/** 연속 모드 한 틱 — 스폰·이동·판정·반납을 전부 여기서 한다 */
function chainTick(now: number) {
  const quotaLeft = !chainTarget.value || chainSpawns < chainTarget.value
  // Keep the playfield readable: do not reveal a new wall until the current
  // wall has been judged and fully left the stage.
  if (quotaLeft && !flying.length && now >= chainNextStart) {
    // 솔로는 앞 벽이 완전히 지나간 뒤에만 다음 벽을 보여준다. 예약 시각을 그대로 쓰면
    // 새 벽이 화면에 뜨는 순간 진행 바가 이미 중간부터 시작하므로, 실제 표시 시각을 출발점으로 쓴다.
    const startAt = isMultiplayer.value ? chainNextStart : now
    spawnChainWall(startAt)
  }

  for (const w of flying) {
    if (w.judged) {
      // 가루가 되며 삭는다 — 위치·디졸브 둘 다 경과 시간의 함수라 프레임 수와 무관하다
      // (프레임당 일정 거리로 밀면 느린 기기에서 더 오래 남아 다음 벽을 가린다)
      const out = Math.min(1, (now - w.judgedAt) / FLY_AWAY_MS)
      w.handle.mesh.position.z = WALL_STOP_Z + FLY_AWAY_Z * out
      w.handle.setDissolve(out)
      continue
    }
    const t = Math.min(1, (now - w.start) / w.approachMs)
    w.handle.mesh.position.z = WALL_START_Z + (WALL_STOP_Z - WALL_START_Z) * easeIn(t)
    if (t >= 1) judgeFlyingWall(w, now)
  }

  flying = flying.filter((w) => {
    if (!w.judged || now - w.judgedAt < FLY_AWAY_MS) return true
    w.handle.mesh.visible = false
    pool.push(w.handle)
    return false
  })

  // 게이지·썸네일·구멍·타이머는 "다음에 도착할 벽" 기준 — 판정 대상이 곧 표시 대상이다
  const next = flying.find((w) => !w.judged)
  if (next) {
    if (setterPose !== next.pose) {
      setterPose = next.pose
      holeMargin = next.margin
      randomPoseName.value = next.name
      adoptSetterPose(next.pose)
    }
    const elapsed = now - next.start
    approachPct.value = Math.round(Math.min(1, elapsed / next.approachMs) * 100)
    timerSec.value = Math.max(0, Math.ceil((next.approachMs - elapsed) / 1000))
  }
  liveJudge(now)
  if (judgment.value && now - popAt > POP_MS) judgment.value = null

  // 할당량을 다 띄우고 마지막 벽까지 지나가면 끝. 무한(0)이면 이 조건은 성립하지 않는다.
  if (chainTarget.value && chainSpawns >= chainTarget.value && !flying.length) finishChain()
}

/** 정해진 장수를 다 받았다 — 요약을 남기고 컨베이어를 접는다 */
function finishChain() {
  if (finalResultTimer) return
  const walls = chainArrived.value
  chainSummary.value = `🏁 ${walls}벽 완주 — 최고 ${bestCombo.value}콤보 · ${totalScore.value}점`
  finalResultTimer = window.setTimeout(() => {
    finalScore.value = totalScore.value
    finalResultTimer = 0
    stopChain()
  }, FINAL_RESULT_DELAY_MS)
}

/** 연속 랜덤 시작/중지 */
function toggleChain() {
  if (chain.value) {
    stopChain()
    return
  }
  chain.value = true
  chainSpawns = 0
  chainNextStart = performance.now() // 첫 벽은 즉시 출발 — 이후는 스케줄이 정한다
  chainArrived.value = 0
  combo.value = 0
  judgment.value = null
  finalScore.value = null
  chainSummary.value = null
  wall.mesh.visible = false // 단발 라운드가 남긴 벽은 치운다
  phase.value = 'incoming' // 컨베이어가 도는 동안은 계속 "벽이 온다" 상태다
}

function stopChain() {
  chain.value = false
  for (const w of flying) {
    w.handle.mesh.visible = false
    pool.push(w.handle)
  }
  flying = []
  setterPose = null
  randomPoseName.value = null
  approachPct.value = 0
  judgment.value = null
  rig.setOverflow([])
  phase.value = 'idle'
}

/**
 * 랜덤 출제(멀티) — 출제자가 누르면 생성 포즈를 바로 서버로 보낸다.
 * 벽은 여기서 세우지 않는다: POSE_SET 에코가 출제자 포함 전원의 challenge watch를 태우므로,
 * 사람이 낸 포즈와 완전히 같은 경로로 같은 벽이 만들어진다.
 */
function submitRandomPose() {
  if (poseSubmitted) return
  const { name, landmarks } = randomPose()
  poseSubmitted = true
  randomPoseName.value = name
  emit('pose-submit', serializePose(landmarks))
}

function easeIn(t: number): number {
  return Math.pow(t, 2.5) // 막판 급가속 (UI 스펙 §7 근사)
}

/** 캡처된 출제 포즈를 좌상단 목표 썸네일에 그린다 (§6-7 — 벽이 다가오면 구멍이 안 보인다) */
function drawThumbnail(setter: SolvedSkeleton) {
  thumb?.show(setter)
}

/**
 * 관전 화면의 큰 구멍 — 석판을 칠한 뒤 실루엣 모양으로 도려낸다(destination-out).
 * 판정에 쓰는 것과 같은 drawSilhouette + 같은 holeMargin이라, 화면의 구멍과
 * 실제 통과 판정 범위가 정의상 일치한다.
 */
function drawHole() {
  const canvas = holeRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx || !setterPose) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#3a332e'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'
  drawSilhouette(ctx, setterPose, cfg, holeMargin)
  ctx.restore()
}

/** 관전 화면: 지금 이 순간 구멍에 못 맞고 있는 사람 수 — 벽이 다가올수록 요동친다 */
const caughtCount = computed(
  () =>
    (props.scores ?? []).filter((r) =>
      r.finished ? (r.score ?? 0) < GRADE_POINTS.PASS : r.holdProgress * 100 < cfg.judge.grade.pass,
    ).length,
)
/**
 * 별점 5★의 기준이 되는 poseDifficulty 값 — 실측 보정 노브.
 * 이론 상한은 1.0이지만 실제 사람 포즈는 0.6을 넘기 어렵다(랩 측정: 차렷 0.04,
 * T자 0.23, 만세 0.44, 양팔 접어 머리 위 0.53). 1.0으로 나누면 4·5★이 안 나온다.
 */
const DIFFICULTY_FULL = 0.7
/** 내가 낸 문제의 체감 난이도 별점(1~5) — 표시 전용 휴리스틱, 점수와 무관 */
const holeStars = ref(0)
const starBar = computed(() => '★'.repeat(holeStars.value) + '☆'.repeat(5 - holeStars.value))

/** 출제 포즈가 확정된 뒤 파생 표시물(썸네일·큰 구멍·난이도)을 한 번에 갱신한다 */
function adoptSetterPose(solved: SolvedSkeleton) {
  drawThumbnail(solved)
  drawHole()
  holeStars.value = 1 + Math.round(Math.min(1, poseDifficulty(solved) / DIFFICULTY_FULL) * 4)
}

/**
 * 출제 포즈 확정 → 구멍 마진 산출·벽 생성·표시물 갱신.
 * 출제 경로가 셋(솔로 캡처 · POSE_SET 수신 · 랜덤 출제)인데 전부 이 순서를 그대로 밟아야 해서
 * 한 함수로 모았다 — 한 곳만 빠지면 그 경로에서만 구멍과 판정이 어긋난다.
 */
function armWall(solved: SolvedSkeleton) {
  setterPose = solved
  holeMargin = holeMarginFor(solved, cfg)
  wall.build(solved, holeMargin, cfg)
  wall.mesh.position.z = WALL_START_Z
  wall.mesh.visible = true
  adoptSetterPose(solved)
  lastLiveJudge = 0
}

/** 랜드마크(카메라 캡처든 랜덤 생성이든) → 이번 라운드의 출제 골격 */
function solveFromLandmarks(lm: LandmarkPoint[]): SolvedSkeleton | null {
  const normalized = normalizePose(lm, true)
  return normalized ? solveSkeleton(normalized, cfg.avatar, createSkeletonState()) : null
}

/** 실시간 판정(4Hz) — 게이지 갱신 + 삐져나온 세그먼트 즉시 빨강 (§7-4) */
function liveJudge(now: number) {
  if (setterPose && rig.lastSolved && now - lastLiveJudge > 250) {
    lastLiveJudge = now
    const live = judgeRound(rig.lastSolved, setterPose, holeMargin, cfg)
    liveIou.value = live.iou
    liveOverflow.value = live.overflow
    rig.setOverflow(live.overflow)
    // 별 개념이 없는 게임이라 starsLit=0, 일치율을 holdProgress(0~1)에 싣는다 —
    // 출제자 관전 화면과 방 스코어보드가 이 값으로 갱신된다.
    // 연속 서바이벌은 순간 일치율이 아니라 누적 점수로 승부하므로 다른 값을 보낸다(emitChainProgress).
    if (isMultiplayer.value && !chainMode.value) emit('progress', 0, Math.min(1, live.iou / 100))
  }
}

function finalizeJudgment(): RoundJudgment {
  const result =
    setterPose && rig.lastSolved
      ? judgeRound(rig.lastSolved, setterPose, holeMargin, cfg)
      : { outsideRatio: 1, passed: false, iou: 0, grade: 'FAIL' as Grade, overflow: [] }
  judgment.value = result
  liveIou.value = result.iou
  liveOverflow.value = result.overflow
  rig.setOverflow(result.overflow)
  return result
}

/** 솔로 모드(개발 라우트) — 로컬 타이머 루프 */
function tickSolo(now: number) {
  // 연속 모드는 페이즈 기계(출제→접근→결과)를 타지 않는다 — 컨베이어가 자체 시계로 돈다
  if (chain.value) {
    chainTick(now)
    return
  }
  if (phase.value === 'setting') {
    timerSec.value = Math.max(0, Math.ceil((captureAt - now) / 1000))
    if (now >= captureAt && rig.lastSolved) {
      armWall(rig.lastSolved)
      approachStart = now
      phase.value = 'incoming'
    }
  } else if (phase.value === 'incoming') {
    const t = Math.min(1, (now - approachStart) / cfg.wall.approachMs)
    timerSec.value = Math.max(0, Math.ceil((cfg.wall.approachMs - (now - approachStart)) / 1000))
    approachPct.value = Math.round(t * 100)
    wall.mesh.position.z = WALL_START_Z + (WALL_STOP_Z - WALL_START_Z) * easeIn(t)
    liveJudge(now)

    if (t >= 1 && setterPose && rig.lastSolved) {
      const result = finalizeJudgment()
      totalScore.value += scoreFor(result)
      history.value.unshift({ round: round.value, grade: result.grade, iou: result.iou })
      emit('finished', { score: scoreFor(result), grade: result.grade, iou: result.iou })
      resultAt = now
      phase.value = 'result'
    }
  } else if (phase.value === 'result') {
    if (judgment.value?.passed && wall.mesh.visible) {
      wall.mesh.position.z += 0.12
      if (wall.mesh.position.z > 4) wall.mesh.visible = false
    }
    if (now - resultAt > 3000) {
      wall.mesh.visible = false
      phase.value = 'idle'
    }
  }
}

/**
 * 멀티 연속 서바이벌 — 출제 페이즈가 없고 startAt부터 컨베이어가 바로 돈다.
 *
 * <p>서버는 시드·벽 수·startAt·endAt만 준다. 벽마다 이벤트를 주고받지 않고 각 클라가 같은
 * 스케줄을 재생하므로(chainSchedule) 네트워크 지연이 벽 위치에 나타나지 않는다.</p>
 */
function tickChainMulti(now: number) {
  const s = props.session!
  const srv = serverNow()
  if (srv < s.startAt) {
    phase.value = 'wait'
    timerSec.value = Math.max(0, Math.ceil((s.startAt - srv) / 1000))
    return
  }
  // 서버가 정한 종료 시각을 넘겼거나 결과가 이미 왔으면 컨베이어를 접는다.
  // 없으면 두 가지가 터진다 ① 가려진 창·프레임 드랍으로 늦은 클라는 벽을 다 못 받아
  // 제출을 못 하고 0점으로 정산된다 ② 세션이 끝난 뒤에도 벽마다 PROGRESS를 보내
  // 서버가 매번 "진행 중 세션 없음" 에러로 되받아친다.
  if (chain.value && (srv >= s.endAt || props.results)) stopChain()
  if (chain.value) {
    phase.value = 'incoming'
    chainTick(now)
    return
  }
  // 컨베이어가 접혔다 = 할당된 벽을 다 받았거나 서버가 끝냈다. 점수를 한 번만 제출한다
  // (서버는 최초 1회만 수리하고, 상한도 벽 수 × 100으로 열려 있다).
  if (!finishedSent) {
    finishedSent = true
    const grade: Grade = bestCombo.value > 0 ? 'PASS' : 'FAIL'
    emit('finished', { score: chainAverage.value, grade, iou: liveIou.value })
  }
  phase.value = !props.results && srv > s.endAt + STALE_MS ? 'stale' : 'result'
}

/** 멀티 모드 — 서버 타임라인(startAt=출제 시작, endAt=벽 도착)에 페이즈를 맞춘다 */
function tickMulti(now: number) {
  const s = props.session!
  const srv = serverNow()
  const settingEnd = s.startAt + SETTING_MS

  if (srv < s.startAt) {
    phase.value = 'wait'
    timerSec.value = Math.max(0, Math.ceil((s.startAt - srv) / 1000))
    return
  }
  if (srv < settingEnd) {
    phase.value = 'setting'
    timerSec.value = Math.max(0, Math.ceil((settingEnd - srv) / 1000))
    // 출제자: 마감 직전 프레임을 캡처해 전송 — 서버가 POSE_SET으로 전원에게 재방송.
    // 포즈를 하나도 못 잡았으면(카메라 꺼짐·인식 실패·자리 비움) 랜덤 포즈로 대신 낸다 —
    // 아무것도 안 보내면 벽이 없어서 그 라운드는 전원 FAIL로 죽는다.
    if (isSetter.value && !poseSubmitted && srv >= settingEnd - 150) {
      if (lastSmoothed) {
        poseSubmitted = true
        emit('pose-submit', serializePose(lastSmoothed))
      } else {
        submitRandomPose()
      }
    }
    return
  }
  if (srv < s.endAt) {
    phase.value = 'incoming'
    timerSec.value = Math.max(0, Math.ceil((s.endAt - srv) / 1000))
    const t = Math.min(1, (srv - settingEnd) / Math.max(1, s.endAt - settingEnd))
    approachPct.value = Math.round(t * 100)
    if (wall.mesh.visible) wall.mesh.position.z = WALL_START_Z + (WALL_STOP_Z - WALL_START_Z) * easeIn(t)
    // 게임④(-9) 룰: 출제자는 이번 라운드에 플레이하지 않는다 — 판정도 제출도 하지 않는다
    if (!isSetter.value) liveJudge(now)
    return
  }
  // 벽 도착 — 프레임 1장 판정, 1회만 제출 (서버도 최초 1회만 수리, 출제자는 애초에 안 보냄)
  if (!finishedSent) {
    finishedSent = true
    if (!isSetter.value) {
      const result = finalizeJudgment()
      emit('finished', { score: scoreFor(result), grade: result.grade, iou: result.iou })
    }
  }
  // 다음 라운드 GAME_START(또는 GAME_END)가 안 오면 여기서 영원히 멈춘다 — 재연결 공백에
  // 프레임 하나만 유실돼도 클라는 복구 수단이 없다. 'result'를 무한정 유지하면 출제자에게는
  // 관전 화면이, 참가자에게는 "집계 중"이 계속 떠서 캠·아바타가 사라진 채 게임이 죽는다.
  // 한계를 넘기면 stale로 내려 화면이 거짓말하지 않게 하고, 다음 GAME_START가 오면 저절로 복구된다.
  phase.value = !props.results && srv > s.endAt + STALE_MS ? 'stale' : 'result'
  if (!isSetter.value && judgment.value?.passed && wall.mesh.visible) {
    wall.mesh.position.z += 0.12
    if (wall.mesh.position.z > 4) wall.mesh.visible = false
  }
}

/**
 * 페이즈 시계 — 서버 시각을 읽어 phase/timer를 갱신하고 제출을 트리거한다.
 * 시계로 계산하니 몇 번 불려도 결과가 같다(제출은 poseSubmitted/finishedSent로 1회 보장).
 */
function tickPhase() {
  if (!stage) return
  const now = performance.now()
  if (isMultiplayer.value && props.session) {
    if (chainMode.value) tickChainMulti(now)
    else tickMulti(now)
  } else tickSolo(now)
  // 사이드 맞춤도 여기서 — ResizeObserver만 걸면 zoom 변경이 다시 리사이즈를 부르는 관계라
  // 갱신이 새는 경우가 있었다. 이미 도는 타이머에 얹으면 컨테이너가 어떻게 바뀌든 자가 복구된다.
  fitSide()
}

function renderLoop() {
  rafId = requestAnimationFrame(renderLoop)
  if (!stage) return
  tickPhase()
  // 관전(출제자)·휴식(전원) 구간에는 아바타를 치운다 — 판정·제출 스킵은 tickMulti에서 이미 처리
  rig.group.visible = !hideAvatar.value
  const camera = stage.camera
  camera.position.x += (rig.group.position.x * 0.35 - camera.position.x) * 0.06
  camera.lookAt(0, -0.5, 0)
  stage.render()
}

// 멀티: 세션 시작 → 난이도 적용 + 라운드 상태 초기화
watch(
  () => props.session,
  (s) => {
    if (!s) return
    applyDifficulty(s.difficulty)
    judgment.value = null
    liveIou.value = 0
    liveOverflow.value = []
    setterPose = null
    holeStars.value = 0
    randomPoseName.value = null
    poseSubmitted = false
    finishedSent = false
    round.value = s.roundNo ?? 1
    if (wall) wall.mesh.visible = false
    rig?.setOverflow([])
    if (s.mode === 'chain') startChainFromSession(s)
  },
  { immediate: true },
)

/**
 * 서버가 연 연속 서바이벌 세션에 컨베이어를 물린다 — 전원이 같은 벽을 같은 순간에 받는 지점.
 *
 * <p>세 값을 서버에서 그대로 받아 쓴다: 시드(포즈 수열) · 벽 수(할당량) · startAt(첫 벽 출발).
 * startAt은 서버 시계라 rAF 시계로 환산해 넣는다 — 이후 벽 위치는 전부 이 원점에서 계산되므로
 * 시계 오프셋만 맞으면 화면이 일치한다.</p>
 */
function startChainFromSession(s: ActiveGameSession) {
  // 연달아 시작한 경우(결과 → 새 판) 이전 컨베이어의 벽을 반납한다 — 안 하면 핸들 풀(4개)이
  // 묶여 새 벽이 안 뜬다. 마운트 직전(immediate)에는 flying이 비어 있어 아무 일도 하지 않는다.
  for (const w of flying) {
    w.handle.mesh.visible = false
    pool.push(w.handle)
  }
  flying = []
  chainTarget.value = s.wallCount ?? 10
  chainRng = seededRng(s.chainSeed ?? String(s.sessionId))
  chain.value = true
  chainSpawns = 0
  chainArrived.value = 0
  combo.value = 0
  bestCombo.value = 0
  totalScore.value = 0
  history.value = []
  chainSummary.value = null
  // 서버 startAt → rAF 시계. serverNow()가 곧 Date.now()+오프셋이라 그 차이만큼 미래로 민다
  chainNextStart = performance.now() + (s.startAt - serverNow())
  phase.value = 'wait'
}

/**
 * 1인 방(로컬 연습) — 출제 대결이 성립하지 않으므로(내가 낸 포즈를 내가 푼다) 연속만 돌린다.
 *
 * <p>인식이 잡힌 뒤에 켠다 — 카메라가 데워지기 전에 시작하면 첫 벽 두어 장을 그냥 잃는다.
 * dev 라우트(!embedded)는 두 모드를 다 눌러봐야 하는 개발 도구라 자동 시작하지 않는다.</p>
 */
watch(tracked, (on) => {
  if (!on || !props.embedded || isMultiplayer.value) return
  if (!chain.value && !chainSummary.value && !roundBusy()) toggleChain()
})

// 멀티: POSE_SET 도착 → 전원이 같은 렌더 함수로 같은 벽을 만든다 (§9-2)
watch(
  () => props.challenge,
  (ch) => {
    if (!ch || !isMultiplayer.value || !wall) return
    try {
      const solved = solveFromLandmarks(parsePose(ch))
      if (solved) armWall(solved)
    } catch {
      /* 손상된 포즈 payload — 벽 없이 진행되면 도착 시 FAIL 처리된다 */
    }
  },
)

// ── 사운드 (S15P11A706-138) ─────────────────
// 페이즈가 바뀔 때만 큐를 갈아끼운다. 큐 길이(30s)가 페이즈보다 길어서 tailMs로 꼬리를 맞춘다 —
// "이 큐가 남은 시간 뒤에 끝나도록" 재생 위치를 역산하면 라이저 절정이 벽 도착과 겹친다.
const audio = new BodyFitAudio()
watch(phase, (p) => {
  const s = props.session
  const srv = serverNow()
  if (p === 'wait') audio.play('rest', { tailMs: s ? s.startAt - srv : 3000 })
  else if (p === 'setting') audio.play('setting', { tailMs: s ? s.startAt + SETTING_MS - srv : 3000 })
  // 연속 모드는 끝나는 시각이 없어서 꼬리를 맞출 수가 없다 — 루프로 계속 깐다
  else if (p === 'incoming')
    audio.play(
      'approach',
      chain.value ? { loop: true } : { tailMs: s ? s.endAt - srv : cfg.wall.approachMs },
    )
  // result에서는 아무것도 틀지 않는다. 중간 라운드의 result는 다음 GAME_START가 올 때까지
  // 0.2~1.5초뿐이라, 여기서 곡을 걸면 시작하자마자 잘려 딸꾹질처럼 들린다.
  // 인게임 곡은 아래 results watch에서 "진짜 끝났을 때"만 튼다.
  // 단, 이미 결과가 와 있으면 멈추지 않는다 — GAME_END가 페이즈 전환보다 먼저 도착하면
  // (rAF가 멈춘 창은 페이즈 갱신이 200ms까지 늦는다) 뒤늦은 stop이 최종 음악을 꺼버린다.
  else if (!props.results) audio.stop() // result · idle · stale
})

/**
 * 사이드바를 자리에 맞게 축소한다 — 스크롤을 만들지 않기 위해서.
 *
 * <p>내용(캠·게이지·점수·난이도)이 고정 px라, 브라우저 배율을 올리거나 타일이 작아지면
 * CSS 픽셀 기준 높이가 모자라 넘친다(1280×720 솔로에서 이미 830 vs 637). 브레이크포인트로
 * 항목을 하나씩 숨기는 대신 통째로 줄여 전부 보이게 한다.</p>
 *
 * <p>transform:scale이 아니라 zoom을 쓰는 이유 — scale은 레이아웃 박스를 그대로 두어
 * 줄인 만큼 빈 공간이 남는다. zoom은 박스까지 줄어 무대가 그 자리를 가져간다.</p>
 */
function fitSide() {
  const el = sideRef.value
  if (!el) return
  el.style.zoom = '1' // 원래 크기로 되돌려 natural height를 잰다
  const avail = el.clientHeight
  const need = el.scrollHeight
  if (!avail || !need) return
  // 0.98은 반올림 여유 — 딱 맞추면 브라우저 반올림 때문에 몇 px가 남아 잘린다.
  // 0.55 아래로는 글씨가 못 읽을 크기라, 그때는 잘리는 쪽을 택한다.
  const z = need > avail ? Math.max(0.55, (avail / need) * 0.98) : 1
  el.style.zoom = String(Math.round(z * 1000) / 1000)
}

/** 최종 결과 오버레이 — 여기가 기획상 ⑤최종 결과(=①인게임 베드) 자리다 */
watch(
  () => props.results,
  (r) => {
    if (r) audio.play('ingame', { loop: true })
  },
)

// 관전 화면의 구멍 캔버스는 v-if라 출제 포즈가 도착한 시점엔 아직 DOM에 없다 —
// 패널이 붙은 뒤 한 번 더 그린다(adoptSetterPose의 drawHole은 그때 no-op이었다).
watch(spectating, async (on) => {
  if (!on) return
  await nextTick()
  drawHole()
})

/**
 * 캠 PiP 박스 비율 — 스트림 실제 비율을 그대로 쓴다.
 *
 * <p>4:3으로 박아두고 object-fit:cover를 걸어놨더니, 16:9 웹캠(getUserMedia의 width·height는
 * 강제가 아니라 힌트라 640×480을 요청해도 640×360으로 오는 기기가 많다)에서 좌우가 잘려나갔다.
 * 그런데 오버레이(drawPip)는 잘리지 않은 <b>전체 프레임</b> 기준 정규화 좌표를 박스에 그대로
 * 곱하므로, 잘린 만큼 스켈레톤이 몸에서 밀린다(가장자리에서 최대 12%).</p>
 *
 * <p>박스 비율 = 스트림 비율로 맞추면 crop이 0이 되어 좌표가 정의상 일치한다.</p>
 */
const camAspect = ref(4 / 3)
function syncCamAspect() {
  const v = videoRef.value
  if (!v?.videoWidth || !v.videoHeight) return
  camAspect.value = v.videoWidth / v.videoHeight
  // 캔버스 백킹도 같은 비율로 — 위치는 어차피 정규화라 맞지만, 비율이 다르면 CSS가 늘려서
  // 관절 점이 타원이 되고 선 굵기가 축마다 달라진다
  const c = pipOverlayRef.value
  if (c && (c.width !== v.videoWidth || c.height !== v.videoHeight)) {
    c.width = v.videoWidth
    c.height = v.videoHeight
  }
}

/** 캠 PiP 스켈레톤 오버레이 — "내 몸 → 인식 → 아바타" 인과 증명 (§6-3) */
function drawPip(lm: LandmarkPoint[] | null) {
  const canvas = pipOverlayRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!lm) return
  const px = (p: LandmarkPoint): [number, number] => [p.x * canvas.width, p.y * canvas.height]
  ctx.strokeStyle = '#48c8a4'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (const [a, b] of PIP_BONES) {
    const pa = lm[a]
    const pb = lm[b]
    if (!pa || !pb || (pa.visibility ?? 0) < 0.3 || (pb.visibility ?? 0) < 0.3) continue
    ctx.beginPath()
    ctx.moveTo(...px(pa))
    ctx.lineTo(...px(pb))
    ctx.stroke()
  }
  ctx.fillStyle = '#48c8a4'
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24]) {
    const p = lm[i]
    if (!p || (p.visibility ?? 0) < 0.3) continue
    ctx.beginPath()
    ctx.arc(...px(p), 4, 0, Math.PI * 2)
    ctx.fill()
  }
}

function onPose(result: PoseLandmarkerResult) {
  const lm = result.landmarks[0]
  tracked.value = !!lm
  drawPip(lm ?? null)
  if (!lm) return
  const smoothed = smoother.apply(lm, performance.now())
  lastSmoothed = smoothed
  const normalized = normalizePose(smoothed, true) // 셀프뷰 표준 — 미러 고정
  if (normalized) rig.updatePose(normalized)
}

onMounted(async () => {
  const canvas = glCanvasRef.value!
  const viewport = viewportRef.value!
  initThree(canvas)

  const resize = () => {
    const w = viewport.clientWidth
    const h = viewport.clientHeight
    if (!w || !h || !stage) return
    stage.setSize(w, h)
  }
  // 사이드는 관찰하지 않는다 — zoom 변경이 다시 리사이즈를 부르는 관계라서. 사이드 맞춤은
  // tickPhase(200ms)가 맡는다.
  resizeObs = new ResizeObserver(resize)
  resizeObs.observe(viewport)
  resize()
  renderLoop()
  // 브라우저는 숨은/가려진 창의 requestAnimationFrame을 멈춘다 — 창 여러 개로 멀티를 테스트하면
  // 뒤에 가린 창은 페이즈 시계가 그대로 얼어붙어 출제 포즈를 제출하지도, 다음 라운드로 넘어가지도
  // 못한다(그 창에서 GAME_START는 STOMP로 계속 오므로 isSetter만 바뀌어 관전 화면에 갇힌다).
  // 렌더는 rAF에 두고, 페이즈 진행만 타이머로 한 번 더 돌린다 — 타이머는 백그라운드에서 1s로
  // 느려질 뿐 멈추지 않는다.
  phaseTimerId = window.setInterval(tickPhase, 200)

  // 멀티(게임룸): 셀프 타일 비디오를 재사용 — 카메라를 새로 열지 않는다 (S15P11A706-33 패턴)
  if (props.video && isMultiplayer.value) {
    const pip = videoRef.value!
    pip.srcObject = props.video.srcObject
    pip.play().catch(() => {})
    // 실패(모델 로드·GPU 초기화)를 삼키면 화면은 도는데 자세만 안 잡힌다(-161) — 한 번
    // 재시도하고, 그래도 안 되면 페이즈 필 자리에 에러를 띄운다(camError와 같은 자리).
    if (!(await pose.start(props.video, onPose)) && !(await pose.start(props.video, onPose))) {
      camError.value = pose.error.value ?? '자세 인식 모델을 불러오지 못했어요'
    }
    return
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    })
  } catch {
    camError.value = '카메라를 열 수 없어요'
    return
  }
  const video = videoRef.value!
  video.srcObject = stream
  await video.play().catch(() => {})
  if (!(await pose.start(video, onPose)) && !(await pose.start(video, onPose))) {
    camError.value = pose.error.value ?? '자세 인식 모델을 불러오지 못했어요'
  }
})

/** 게임룸이 게임 화면을 captureStream으로 송출할 수 있게 3D 캔버스를 노출 (게임① 패턴) */
defineExpose({ canvas: glCanvasRef })

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  clearInterval(phaseTimerId)
  clearTimeout(finalResultTimer)
  audio.dispose()
  stream?.getTracks().forEach((t) => t.stop())
  resizeObs?.disconnect()
  rig?.dispose()
  thumb?.dispose()
  thumb = null
  wall?.dispose()
  // 연속 모드용 풀 — 날아오던 것과 반납된 것 모두 (텍스처 2장 + 캔버스 2장씩 물고 있다)
  for (const w of flying) w.handle.dispose()
  for (const h of pool) h.dispose()
  flying = []
  pool = []
  stage?.dispose()
  stage = null
})
</script>

<template>
  <div class="game" :class="{ embedded }">
    <header class="topbar">
      <span v-if="camError" class="pill phase-pill">{{ camError }}</span>
    </header>

    <div class="main">
      <div class="center">
        <div ref="viewportRef" class="viewport" :class="{ 'my-turn': myPoseTurn }">
          <div class="viewport-meta">
            <span class="pill round-pill">{{ round }}{{ totalRoundsLabel }} 라운드</span>
            <span class="pill setter-pill" :class="{ mine: isMultiplayer && isSetter }">
              👑 출제자 {{ setterLabel }}
            </span>
          </div>
          <div v-if="!(isMultiplayer && isSetter)" class="accuracy-card">
            <svg viewBox="0 0 120 120" class="gauge">
              <circle cx="60" cy="60" :r="GAUGE_R" class="track" />
              <circle
                cx="60"
                cy="60"
                :r="GAUGE_R"
                class="fill"
                :stroke="GRADE_COLOR[gaugeGrade]"
                :stroke-dasharray="GAUGE_C"
                :stroke-dashoffset="gaugeOffset"
              />
              <line
                v-for="tick in gaugeTicks"
                :key="tick.label"
                x1="60"
                y1="4"
                x2="60"
                y2="12"
                class="tick"
                :transform="`rotate(${(tick.pct / 100) * 360} 60 60)`"
              />
              <text x="60" y="60" dominant-baseline="middle" class="gauge-num" :fill="GRADE_COLOR[gaugeGrade]">
                {{ Math.round(liveIou) }}<tspan class="pct">%</tspan>
              </text>
            </svg>
          </div>
          <div v-if="!chainMode" class="score-card participant-ranking-card">
            <h3>참가자 순위</h3>
            <p class="score">{{ totalScore }}<small>점</small></p>
            <ul v-if="participantRanking.length" class="rank-list score-ranking">
              <li v-for="(row, i) in participantRanking" :key="row.userId" :class="{ me: row.userId === myUserId }">
                <span class="rk-no">{{ i + 1 }}</span>
                <span class="rk-name">{{ row.nickname }}</span>
                <span class="rk-score">{{ Math.round(row.rankingScore) }}</span>
              </li>
            </ul>
            <p v-else class="rank-empty">참가자 점수를 기다리는 중입니다.</p>
          </div>
          <!-- 관전 중에는 3D를 숨기기만 한다(v-if로 떼면 three.js 컨텍스트가 날아간다) -->
          <canvas v-show="!spectating" ref="glCanvasRef" class="gl-canvas"></canvas>

          <canvas
            v-show="phase === 'incoming' && !spectating"
            ref="thumbRef"
            class="thumb"
            :class="{ 'solo-thumb': !isMultiplayer }"
            width="96"
            height="96"
          ></canvas>

          <!-- 상단 pill만으론 내 차례를 못 알아챈다는 피드백 — 출제 구간엔 무대 안에도 박아준다 -->
          <div v-if="myPoseTurn" class="turn-banner">
            👑 내가 출제자! 내 포즈가 벽 구멍이 됩니다
          </div>

          <!-- 라운드 사이 휴식 — 출제 카운트다운(골드·초대형 숫자)과 색·크기·구성을 완전히 분리했다 -->
          <div v-if="phase === 'wait'" class="rest-panel">
            <span class="rest-tag">{{ firstWait ? '🎬 곧 시작' : '☕ 쉬는 시간' }}</span>
            <p class="rest-who">{{ restWho }}</p>
            <p class="rest-hint">{{ isSetter ? '어떤 포즈를 낼지 생각해 두세요' : '카메라 앞으로 돌아와 준비하세요' }}</p>
            <span class="rest-sec">{{ timerSec }}<small>초 후 출제 시작</small></span>
          </div>

          <!-- 라운드 이벤트 유실 — 관전 화면(거짓)이 아니라 상태를 그대로 알린다. 캠·아바타는 되돌아온다 -->
          <div v-if="phase === 'stale'" class="rest-panel stale">
            <span class="rest-tag">⚠ 연결 지연</span>
            <p class="rest-who">라운드 정보를 못 받았어요</p>
            <p class="rest-hint">다음 라운드가 시작되면 자동으로 복구됩니다</p>
          </div>

          <div v-if="phase === 'setting'" class="countdown">
            <span class="cd-cap">{{ countdownCaption }}</span>
            <strong>{{ timerSec }}</strong>
          </div>

          <div v-if="judgment" class="grade-pop" :style="{ color: GRADE_COLOR[judgment.grade] }">
            <strong>{{ judgment.grade }}</strong>
            <!-- FAIL도 일치율만큼 점수를 받는다 — 안 보여주면 0점처럼 느껴진다 -->
            <span>일치율 {{ judgment.iou.toFixed(0) }}% · +{{ scoreFor(judgment) }}점</span>
            <!-- 일치율이 높은데 FAIL이면 이유 없이는 판정을 불신한다 — 어디가 걸렸는지 짚어준다 -->
            <em v-if="failReason" class="fail-why">{{ failReason }}</em>
          </div>

          <div v-if="phase === 'incoming' && !spectating" class="approach-bar" :class="{ urgent: timerSec <= 2 }">
            <div class="fill" :style="{ width: approachPct + '%' }"></div>
          </div>

          <!-- 게임④(-9) 출제자 관전 화면 — 내가 낸 구멍이 주인공이고, 도전자는 그 옆 링으로 본다 -->
          <div v-if="spectating" class="spectate-panel">
            <!-- 랜덤으로 냈으면 "내가 만든"이 거짓이 된다 — 누가 만든 구멍인지는 그대로 말해준다 -->
            <p class="sp-title">
              🧱 {{ randomPoseName ? `랜덤 구멍 「${randomPoseName}」` : '내가 만든 구멍' }}
            </p>

            <div class="sp-stage">
              <canvas ref="holeRef" class="sp-hole" width="240" height="240"></canvas>

              <ul v-if="scores?.length" class="sp-rings">
                <li v-for="row in scores" :key="row.userId">
                  <svg viewBox="0 0 40 40" class="sp-ring">
                    <circle cx="20" cy="20" :r="RING_R" class="rt" />
                    <circle
                      cx="20"
                      cy="20"
                      :r="RING_R"
                      class="rf"
                      :stroke="GRADE_COLOR[row.finished ? gradeOf(row.score) : liveGradeOf(row.holdProgress)]"
                      :stroke-dasharray="RING_C"
                      :stroke-dashoffset="RING_C * (1 - Math.min(1, row.holdProgress))"
                    />
                    <text x="20" y="24" class="rn">
                      {{ row.finished ? '✓' : Math.round(row.holdProgress * 100) }}
                    </text>
                  </svg>
                  <span class="sp-name">{{ row.nickname }}</span>
                </li>
              </ul>
              <p v-else class="sp-empty">참가자 진행 상황을 기다리는 중…</p>
            </div>

            <p class="sp-caught" :class="{ hot: caughtCount > 0 }">
              지금 <b>{{ caughtCount }}</b> / {{ scores?.length ?? 0 }}명 걸림{{
                caughtCount > 0 ? ' 🔥' : ''
              }}
            </p>
            <p v-if="holeStars" class="sp-diff">난이도 <b>{{ starBar }}</b></p>
          </div>
        </div>
      </div>

      <aside ref="sideRef" class="side">
        <!-- 내 캠 — 무대 위 PiP였으나 통과율 위(사이드 최상단)로 옮겼다(실기 피드백) -->
        <div class="pip" :style="{ '--cam-aspect': camAspect }">
          <!-- resize도 듣는다 — 스트림 해상도가 바뀔 때 loadedmetadata는 다시 오지 않는다 -->
          <video
            ref="videoRef"
            class="pip-video mirrored"
            muted
            playsinline
            @loadedmetadata="syncCamAspect"
            @resize="syncCamAspect"
          ></video>
          <canvas ref="pipOverlayRef" class="pip-overlay mirrored" width="640" height="480"></canvas>
          <span class="pip-label">● 내 캠 · {{ tracked ? '인식 중' : '인식 안 됨' }}</span>
        </div>

        <div v-if="isMultiplayer && isSetter" class="card gauge-card">
          <h3>상태</h3>
          <p class="spectate">👀 관전 중 — 이번 라운드는 안 뛰어요</p>
        </div>
        <div v-else-if="false" class="card gauge-card accuracy-card">
          <h3>정확도</h3>
          <svg viewBox="0 0 120 120" class="gauge">
            <circle cx="60" cy="60" :r="GAUGE_R" class="track" />
            <circle
              cx="60"
              cy="60"
              :r="GAUGE_R"
              class="fill"
              :stroke="GRADE_COLOR[gaugeGrade]"
              :stroke-dasharray="GAUGE_C"
              :stroke-dashoffset="gaugeOffset"
            />
            <line
              v-for="tick in gaugeTicks"
              :key="tick.label"
              x1="60"
              y1="4"
              x2="60"
              y2="12"
              class="tick"
              :transform="`rotate(${(tick.pct / 100) * 360} 60 60)`"
            />
            <text x="60" y="60" dominant-baseline="middle" class="gauge-num" :fill="GRADE_COLOR[gaugeGrade]">
              {{ Math.round(liveIou) }}<tspan class="pct">%</tspan>
            </text>
          </svg>
          <p class="gauge-hint">PASS {{ cfg.judge.grade.pass }} · GREAT {{ cfg.judge.grade.great }} · PERFECT {{ cfg.judge.grade.perfect }}</p>
        </div>

        <!--
          연속 서바이벌 실시간 순위 — 이 모드엔 출제자가 없어서 관전 화면(남의 진행 상황이 보이던
          자리)이 아무에게도 뜨지 않는다. 점수로 승부를 가르는데 뛰는 동안 누가 앞서는지 안 보이면
          끝나고 순위표를 볼 때까지 혼자 하는 것처럼 느껴진다.
        -->
        <div v-if="isMultiplayer && chainMode" class="card rank-card">
          <h3>실시간 순위</h3>
          <ul v-if="chainRanking.length" class="rank-list">
            <li
              v-for="(row, i) in chainRanking"
              :key="row.userId"
              :class="{ me: row.userId === myUserId, done: row.finished }"
            >
              <span class="rk-no">{{ i + 1 }}</span>
              <span class="rk-name">{{ row.nickname }}</span>
              <span v-if="row.starsLit > 1" class="rk-combo">🔥{{ row.starsLit }}</span>
              <span class="rk-score">{{ Math.round(chainScoreOf(row)) }}</span>
              <i class="rk-bar" :style="{ width: Math.min(100, row.holdProgress * 100) + '%' }"></i>
            </li>
          </ul>
          <p v-else class="rank-empty">첫 벽이 지나가면 순위가 잡혀요</p>
        </div>

        <div v-if="false" class="card score-card">
          <h3>참가자 순위</h3>
          <p class="score">{{ totalScore }}<small>점</small></p>
          <!-- 연속 모드의 성적 — 이번 콤보와 최고 기록. 모드를 켠 적이 있으면 계속 보여준다 -->
          <p v-if="chain || bestCombo" class="combo">
            🔥 {{ combo }}콤보 <small>최고 {{ bestCombo }}</small>
          </p>
          <!-- 순위·랭킹에 올라가는 값은 벽 평균이다 — 위 누적 총점과 다른 숫자라 같이 보여준다 -->
          <p v-if="isMultiplayer && chainMode" class="combo">
            📊 벽 평균 <b>{{ chainAverage }}</b>점 <small>순위 기준</small>
          </p>
          <ul v-if="!chainMode && participantRanking.length" class="rank-list score-ranking">
            <li v-for="(row, i) in participantRanking" :key="row.userId" :class="{ me: row.userId === myUserId }">
              <span class="rk-no">{{ i + 1 }}</span>
              <span class="rk-name">{{ row.nickname }}</span>
              <span class="rk-score">{{ Math.round(row.rankingScore) }}</span>
            </li>
          </ul>
          <p v-else-if="!chainMode" class="rank-empty">참가자 점수를 기다리는 중입니다.</p>
          <EarnedPoints :results="results" :my-user-id="myUserId" />
        </div>

        <!--
          솔로 조작. ▶ 시작(내 포즈로 출제)은 dev 라우트 전용이다 — 1인 방에서는 내가 낸 포즈를
          내가 푸는 셈이라 게임이 성립하지 않고, 연속 서바이벌이 자동으로 돌아간다(watch(tracked)).
        -->
        <div v-if="!isMultiplayer" class="start-row">
          <button
            v-if="!embedded"
            class="btn-start"
            :disabled="!tracked || chain || roundBusy()"
            @click="startRound"
          >
            ▶ {{ round === 0 ? '시작' : '다음' }}
          </button>
          <button v-if="false"
            class="btn-start btn-random"
            :class="{ on: chain }"
            :disabled="chain ? false : !tracked || roundBusy()"
            :title="chain ? '연속 출제를 멈춥니다' : '코드가 만든 포즈로 벽이 계속 날아옵니다'"
            @click="toggleChain"
          >
            {{ chain ? (chainTarget ? `■ ${chainArrived}/${chainTarget}` : '■ 중지') : '🎲 연속' }}
          </button>
        </div>

        <!-- 연속 모드 분량 — 돌고 있는 중에는 못 바꾼다(가속 곡선과 진행률이 중간에 어긋난다) -->
        <div v-if="false" class="card diff-card">
          <h3>연속 벽 수</h3>
          <div class="diff-buttons">
            <button
              v-for="n in CHAIN_TARGETS"
              :key="n"
              class="diff-btn"
              :class="{ active: chainTarget === n }"
              :disabled="chain"
              @click="chainTarget = n"
            >
              {{ n === 0 ? '∞' : n }}
            </button>
          </div>
        </div>

        <!-- 멀티: 내 출제 차례에 포즈 잡기 대신 코드에 맡긴다. 누르는 즉시 전원에게 벽이 뜬다 -->
        <button v-if="myPoseTurn && !randomPoseName" class="btn-start" @click="submitRandomPose">
          🎲 랜덤 포즈로 출제
        </button>

        <div v-if="false" class="card diff-card">
          <h3>난이도</h3>
          <div class="diff-buttons">
            <button
              v-for="d in DIFFICULTIES"
              :key="d.key"
              class="diff-btn"
              :class="{ active: difficulty === d.key }"
              @click="setDifficulty(d.key)"
            >
              {{ d.label }} {{ (cfg.difficulty[d.key].approachMs / 1000).toFixed(0) }}s
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 멀티: GAME_END 순위 오버레이 -->
    <div v-if="results || finalScore !== null" class="results-overlay">
      <div class="results-card" :class="{ compact: !results }">
        <h2>🏁 게임 종료</h2>
        <p v-if="displayedFinalScore !== null" class="final-score">
          최종 점수 <b>{{ displayedFinalScore }}</b><small>점</small>
        </p>
        <ol v-if="results" class="results-list">
          <li v-for="r in results" :key="r.userId" :class="{ me: r.userId === myUserId }">
            <span class="rank">{{ r.rank }}위</span>
            <span class="name">{{ r.nickname }}</span>
            <b class="pts">{{ r.score }}점</b>
          </li>
        </ol>
        <button class="btn-start" @click="closeFinalResult">종료</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game {
  position: relative;
  /* 게임④ HUD — "석재 명판" 방향(2026-07-28). 3D 무대가 차가운 인디고 화강암이라
     HUD는 따뜻한 석재로 온도 대비를 준다(컨셉 레퍼런스와 같은 구조).
     색뿐 아니라 보더·모서리·그림자까지 전부 여기서만 정의한다 — 이전에는
     1px/18px/블러 값이 컴포넌트마다 흩어져 한 곳에서 바꿀 수 없었다. */
  --bf-bg: #221d1a; /* 그늘진 돌 */
  --bf-panel: #3a332e; /* 석판 */
  --bf-panel-2: #4a423c; /* 밝은 석판 */
  --bf-border: #6b5f54; /* 석재 이음매 */
  --bf-text: #f2e6d2; /* 사암 */
  --bf-muted: #a8977f;
  --bf-mint: #7fb98a; /* 이끼 */
  --bf-gold: #e8b84b; /* 골드 인레이 */
  --bf-coral: #d9694f; /* 테라코타 */
  --bf-violet: #c9a6ff; /* PERFECT 전용 — 단색 무대에서 유일하게 튀는 색이라 최고 등급이 눈에 박힌다 */

  /* 형태 토큰 — 돌은 둥글지 않다 */
  --bf-radius: 4px;
  --bf-radius-sm: 3px;
  --bf-line: 1px solid var(--bf-border);
  --bf-shadow: 0 10px 26px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 236, 200, 0.14);
  --bf-shadow-sm: 0 4px 12px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 236, 200, 0.12);
  /* 석재 입자 — 단색 평면이 플라스틱처럼 보이는 걸 막는다 */
  --bf-grain:
    radial-gradient(circle at 18% 22%, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px),
    radial-gradient(circle at 63% 71%, rgba(0, 0, 0, 0.05) 0 1px, transparent 1px);
  --bf-grain-size: 13px 13px, 17px 17px;

  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100vh;
  padding: 16px;
  background-color: var(--bf-bg);
  background-image: var(--bf-grain);
  background-size: var(--bf-grain-size);
  color: var(--bf-text);
  /* 방 화면은 루트에서 전역 픽셀 폰트를 쓰는데 게임 화면만 산세리프로 튀고 있었다 */
  font-family: var(--font-pixel);
  /* 어떤 배율에서도 게임 밖으로 스크롤바가 생기지 않게 한다 */
  overflow: hidden;
}
/* 게임룸 셀프 타일 위 오버레이(멀티) — 자체 페이지가 아니라 타일을 채운다 */
.game.embedded {
  position: absolute;
  inset: 0;
  height: 100%;
  z-index: 5;
  border-radius: inherit;
}
.results-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  background: rgba(4, 5, 14, 0.72);
}
.results-card {
  min-width: 300px;
  padding: 20px;
  background-color: var(--bf-panel);
  background-image: var(--bf-grain);
  background-size: var(--bf-grain-size);
  border: var(--bf-line);
  border-radius: var(--bf-radius);
  box-shadow: var(--bf-shadow);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.results-card h2 {
  font-size: 18px;
  font-weight: 800;
}
.results-card.compact {
  min-width: 0;
  width: min(250px, calc(100vw - 40px));
  padding: 16px;
  gap: 8px;
}
.results-card.compact h2 {
  text-align: center;
}
.results-card.compact .btn-start {
  padding: 11px;
}
.final-score {
  margin: 0;
  padding: 14px;
  text-align: center;
  background: var(--bf-panel-2);
  border: 1px solid #8a6d33;
  border-radius: var(--bf-radius-sm);
  color: var(--bf-muted);
}
.final-score b {
  margin-left: 6px;
  font-size: 30px;
  color: var(--bf-gold);
  font-variant-numeric: tabular-nums;
}
.final-score small {
  margin-left: 2px;
  color: var(--bf-text);
}
.results-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.results-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: var(--bf-line);
  border-radius: var(--bf-radius-sm);
  background: var(--bf-panel-2);
  font-size: 14px;
}
.results-list li.me {
  background: rgba(127, 185, 138, 0.16);
  border-color: var(--bf-mint);
}
.results-list .rank {
  font-weight: 800;
  width: 34px;
}
.results-list .name {
  flex: 1;
}
.results-list .pts {
  font-variant-numeric: tabular-nums;
}
.topbar {
  position: absolute;
  z-index: 6;
  top: 28px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  transform: translateX(-50%);
  pointer-events: none;
}
.pill {
  padding: 7px 14px;
  background-color: var(--bf-panel);
  background-image: var(--bf-grain);
  background-size: var(--bf-grain-size);
  border: var(--bf-line);
  border-radius: var(--bf-radius-sm);
  box-shadow: var(--bf-shadow-sm);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.round-pill {
  background-color: var(--bf-panel-2);
  color: var(--bf-gold);
}
.phase-pill {
  flex: 1;
  text-align: center;
  color: var(--bf-text);
}
.timer-pill {
  font-variant-numeric: tabular-nums;
  background-color: var(--bf-panel-2);
  color: var(--bf-gold);
  border-color: #8a6d33;
}
.timer-pill.urgent {
  background-color: var(--bf-coral);
  color: #221d1a;
  border-color: var(--bf-coral);
}
.setter-pill {
  background-color: #443a26;
  color: var(--bf-gold);
  border-color: #8a6d33;
}
/* 내가 출제자일 때 — 같은 골드 계열 안에서 명도를 반전시켜 눌러 담는다(실기 피드백: 내 차례를 못 알아챈다) */
.setter-pill.mine {
  background-color: var(--bf-gold);
  background-image: none;
  color: #221d1a;
  animation: bf-setter-pulse 1.4s ease-in-out infinite;
}
@keyframes bf-setter-pulse {
  50% {
    box-shadow: var(--bf-shadow-sm), 0 0 0 3px rgba(232, 184, 75, 0.35);
  }
}
.main {
  display: flex;
  position: relative;
  gap: 14px;
  flex: 1;
  min-height: 0;
}
.center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: var(--bf-radius);
  box-shadow: var(--bf-shadow);
  overflow: hidden;
  /* three.js scene.background(0x1a1411)와 같은 값 — 캔버스 로드 전 깜빡임 방지 */
  background: #1a1411;
}
.viewport-meta {
  position: absolute;
  z-index: 4;
  top: 16px;
  right: 12px;
  left: 12px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 8px;
  pointer-events: none;
}
.viewport-meta .pill {
  padding: 0;
  background: transparent;
  background-image: none;
  border: 0;
  box-shadow: none;
}
.viewport-meta .setter-pill.mine {
  animation: none;
}
/* 3D 캔버스에만 — .viewport canvas로 잡으면 썸네일·PiP 오버레이 캔버스까지 늘어난다 */
.gl-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.thumb {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 96px;
  height: 96px;
  background: rgba(26, 20, 17, 0.75);
  /* 목표 포즈는 무대 위에 얹힌 골드 명판 — 2px 유지(어두운 무대에서 얇으면 사라진다) */
  border: 2px solid var(--bf-gold);
  border-radius: var(--bf-radius-sm);
  box-shadow: var(--bf-shadow-sm);
}
.thumb.solo-thumb {
  top: 62px;
}
/* 사이드 최상단 카드 — 무대 오버레이가 아니라 통과율 위에 놓인다 */
.pip {
  position: relative;
  flex-shrink: 0;
  /* 오버레이(drawPip)가 잘리지 않은 전체 프레임 기준 좌표를 쓰므로 crop이 생기면 안 된다 —
     박스 비율을 스트림 비율(--cam-aspect)에 맞춰 crop을 0으로 만든다(syncCamAspect 주석 참고) */
  width: 100%;
  border: var(--bf-line);
  border-radius: var(--bf-radius);
  overflow: hidden;
  box-shadow: var(--bf-shadow-sm);
  background: #000;
}
.pip-video {
  display: block;
  width: 100%;
  aspect-ratio: var(--cam-aspect, 4 / 3);
  object-fit: cover;
}
/* 라벨을 흐름에서 빼 절대 배치로 얹는다 — 블록으로 두면 .pip 높이가 라벨만큼 늘어나서
   오버레이 높이를 calc(100% - 22px)처럼 라벨 높이를 손으로 빼줘야 했다(폰트가 바뀌면 어긋난다) */
.pip-overlay {
  position: absolute;
  inset: 0;
  /* canvas의 width·height 속성은 CSS 크기 힌트로도 먹는다 — 명시하지 않으면 백킹 해상도
     그대로(1280×720 CSS px) 그려져 박스를 넘친다. 라벨이 절대 배치라 100%가 곧 비디오 높이다 */
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.mirrored {
  transform: scaleX(-1);
}
.pip-label {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 3px 8px;
  background: rgba(34, 29, 26, 0.82);
  color: var(--bf-muted);
  font-size: 11px;
  font-weight: 700;
}
.countdown {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--bf-gold);
  text-shadow: 0 6px 24px rgba(255, 207, 77, 0.4);
  pointer-events: none;
}
.countdown strong {
  font-size: 120px;
  font-weight: 800;
  line-height: 1;
}
.cd-cap {
  padding: 6px 14px;
  background: rgba(26, 20, 17, 0.72);
  border: var(--bf-line);
  border-radius: var(--bf-radius-sm);
  font-size: 15px;
  font-weight: 700;
  text-align: center;
}
/* 라운드 사이 휴식 — 출제 카운트다운은 "골드 + 초대형 숫자 단독", 여기는 "이끼색 + 문장 위주 + 작은 숫자".
   같은 자리에 같은 톤으로 뜨던 게 헷갈림의 원인이라 색·크기·구성을 전부 어긋나게 잡았다. */
.rest-panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  /* 아바타를 치운 빈 무대를 한 번 더 눌러 글씨만 남게 한다 */
  background: rgba(18, 24, 20, 0.86);
  color: var(--bf-mint);
  pointer-events: none;
}
/* 유실 상태는 휴식과 같은 레이아웃을 쓰되 색만 경고색으로 — "쉬는 중"과 혼동하면 안 된다 */
.rest-panel.stale {
  color: var(--bf-coral);
}
.rest-tag {
  padding: 5px 12px;
  border: 1px solid var(--bf-mint);
  border-radius: var(--bf-radius-sm);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
}
.rest-who {
  font-size: 30px;
  font-weight: 800;
  line-height: 1.3;
  text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.5);
}
.rest-hint {
  font-size: 14px;
  color: var(--bf-muted);
}
.rest-sec {
  margin-top: 4px;
  font-size: 40px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--bf-text);
}
.rest-sec small {
  margin-left: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--bf-muted);
}
/* 내 출제 차례 — 무대 테두리까지 골드로 물들여 "지금 나다"를 놓칠 수 없게 한다 */
.viewport.my-turn {
  border-color: var(--bf-gold);
  box-shadow: var(--bf-shadow), inset 0 0 0 3px rgba(232, 184, 75, 0.55);
}
.turn-banner {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  background: var(--bf-gold);
  border: 1px solid #8a6d33;
  border-radius: var(--bf-radius-sm);
  box-shadow: var(--bf-shadow-sm);
  color: #221d1a;
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
  pointer-events: none;
  z-index: 2;
}
.grade-pop {
  position: absolute;
  top: 20px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}
.grade-pop strong {
  font-size: 54px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-shadow: 4px 4px 0 rgba(0, 0, 0, 0.55);
}
.grade-pop span {
  font-size: 14px;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
/* 실패 사유 — 등급색(코랄)을 그대로 물려받아 FAIL과 한 덩어리로 읽히게 한다 */
.fail-why {
  padding: 4px 12px;
  background: rgba(26, 20, 17, 0.72);
  border: 1px solid currentColor;
  border-radius: var(--bf-radius-sm);
  font-size: 13px;
  font-style: normal;
  font-weight: 700;
}
.approach-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 8px;
  background: rgba(0, 0, 0, 0.45);
}
.approach-bar .fill {
  height: 100%;
  background: var(--bf-mint);
  transition: width 100ms linear;
}
.approach-bar.urgent .fill {
  background: var(--bf-coral);
}
.side {
  position: absolute;
  z-index: 5;
  top: 56px;
  right: 12px;
  bottom: 12px;
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* 스크롤 금지 — 넘치는 만큼은 fitSide()가 zoom으로 줄인다(스크립트 주석 참고).
     hidden이어야 scrollHeight로 "원래 필요한 높이"를 읽을 수 있다 */
  overflow: hidden;
}
.card {
  padding: 14px;
  background-color: var(--bf-panel);
  background-image: var(--bf-grain);
  background-size: var(--bf-grain-size);
  border: var(--bf-line);
  border-radius: var(--bf-radius);
  box-shadow: var(--bf-shadow-sm);
}
.card h3 {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  /* 골드 인레이 — 돌에 새겨 넣은 제목 */
  color: var(--bf-gold);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
.gauge {
  display: block;
  width: 150px;
  margin: 0 auto;
}
.accuracy-card {
  position: absolute;
  z-index: 5;
  bottom: 18px;
  left: 18px;
  padding: 0;
  background: transparent;
  background-image: none;
  border: 0;
  box-shadow: none;
  pointer-events: none;
}
.accuracy-card h3,
.accuracy-card .gauge-hint {
  display: none;
}
.participant-ranking-card {
  position: absolute;
  z-index: 5;
  right: 18px;
  bottom: 18px;
  width: min(220px, calc(100% - 36px));
  padding: 0;
  background: transparent;
  background-image: none;
  border: 0;
  box-shadow: none;
  pointer-events: none;
  text-align: right;
}
.participant-ranking-card h3 {
  margin-bottom: 2px;
  color: var(--bf-gold);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.participant-ranking-card .score {
  font-size: 24px;
  line-height: 1;
}
.participant-ranking-card .score-ranking {
  margin-top: 6px;
  max-height: 132px;
}
.participant-ranking-card .rank-list li {
  padding: 4px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  justify-content: flex-end;
}
.participant-ranking-card .rk-name {
  flex: 0 1 auto;
}
.participant-ranking-card .rk-score {
  margin-left: 8px;
}
.participant-ranking-card .rank-list li.me {
  color: #f0e6d2;
}
.gauge .track {
  fill: none;
  stroke: var(--bf-panel-2);
  stroke-width: 11;
}
.gauge .fill {
  fill: none;
  stroke-width: 11;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 60px 60px;
  transition: stroke-dashoffset 250ms linear, stroke 250ms linear;
}
.gauge .tick {
  stroke: var(--bf-muted);
  stroke-width: 2;
}
.gauge-num {
  font-size: 30px;
  font-weight: 800;
  text-anchor: middle;
  font-variant-numeric: tabular-nums;
}
.gauge-num .pct {
  font-size: 14px;
}
.gauge-hint {
  margin-top: 6px;
  text-align: center;
  font-size: 11px;
  color: var(--bf-muted);
}
.spectate {
  text-align: center;
  font-size: 12px;
  color: var(--bf-muted);
  padding: 20px 0;
}
/* 출제자 관전 화면 — 3D를 덮는 게 아니라 3D가 숨겨진 자리에 들어간다 */
.spectate-panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  overflow: hidden;
}
.sp-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--bf-gold);
}
/* 구멍(주인공)과 도전자 링을 나란히 — 좁으면 링이 아래로 내려간다 */
.sp-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 18px;
}
/* 석판을 도려낸 구멍 — 뚫린 자리로 어두운 무대가 보인다.
   게임룸 셀프 타일에 얹히면 세로가 먼저 좁아지므로 높이 기준으로 잰다(가로 기준이면 넘친다) */
.sp-hole {
  flex: 0 0 auto;
  aspect-ratio: 1;
  height: min(200px, 50%);
  width: auto;
  border: 2px solid var(--bf-gold);
  border-radius: var(--bf-radius-sm);
  box-shadow: var(--bf-shadow-sm);
}
.sp-rings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  max-width: 180px;
}
.sp-rings li {
  width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.sp-ring {
  width: 52px;
  height: 52px;
}
.sp-ring .rt {
  fill: none;
  stroke: var(--bf-panel-2);
  stroke-width: 5;
}
.sp-ring .rf {
  fill: none;
  stroke-width: 5;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 20px 20px;
  transition: stroke-dashoffset 250ms linear, stroke 250ms linear;
}
.sp-ring .rn {
  fill: var(--bf-text);
  font-size: 13px;
  font-weight: 800;
  text-anchor: middle;
  font-variant-numeric: tabular-nums;
}
.sp-name {
  max-width: 52px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--bf-muted);
}
.sp-caught {
  font-size: 15px;
  font-weight: 700;
  color: var(--bf-muted);
}
.sp-caught b {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
.sp-caught.hot {
  color: var(--bf-coral);
}
.sp-diff {
  font-size: 13px;
  color: var(--bf-muted);
}
.sp-diff b {
  color: var(--bf-gold);
  letter-spacing: 0.1em;
}
.sp-empty {
  font-size: 12px;
  color: var(--bf-muted);
}
.warn-box {
  padding: 10px 12px;
  background: rgba(217, 105, 79, 0.14);
  border: 1px solid var(--bf-coral);
  border-radius: var(--bf-radius-sm);
  color: var(--bf-coral);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
}
/* 실시간 순위 — 한 줄이 곧 막대다(진행률을 배경으로 깔고 글자를 그 위에 얹는다) */
.rank-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rank-list li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px;
  overflow: hidden;
  border: 1px solid #4a4038;
  border-radius: var(--bf-radius-sm);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--bf-muted);
}
/* 내 줄은 골드 테두리로 — 순위가 뒤집혀도 내 위치를 눈으로 따라갈 수 있어야 한다 */
.rank-list li.me {
  border-color: var(--bf-gold);
  color: #f0e6d2;
}
.rank-list li.done .rk-score {
  color: var(--bf-gold);
}
.rk-no {
  flex: none;
  width: 14px;
  font-weight: 800;
  color: var(--bf-gold);
}
.rk-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rk-combo {
  flex: none;
  font-size: 10px;
}
.rk-score {
  flex: none;
  margin-left: auto;
  font-weight: 700;
}
/* 글자 아래에 깔리는 진행 막대 — z-index 대신 순서로 눕힌다(글자가 위) */
.rk-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--bf-gold);
  transition: width 0.25s linear;
}
.rank-empty {
  font-size: 11px;
  color: var(--bf-muted);
}
.score-ranking {
  margin-top: 8px;
  max-height: 180px;
  overflow-y: auto;
}
.score {
  font-size: 30px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.score small {
  font-size: 14px;
  margin-left: 2px;
  color: var(--bf-muted);
}
.history {
  margin-top: 8px;
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.history li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-variant-numeric: tabular-nums;
  color: var(--bf-muted);
}
.btn-start {
  padding: 13px;
  background: var(--bf-gold);
  color: #221d1a;
  border: 1px solid #8a6d33;
  border-radius: var(--bf-radius-sm);
  box-shadow: var(--bf-shadow-sm);
  font-family: inherit;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}
.btn-start:hover:not(:disabled) {
  transform: translateY(-1px);
}
.btn-start:active:not(:disabled) {
  transform: translateY(0);
}
.btn-start:disabled {
  opacity: 0.4;
  cursor: default;
}
/* 시작 / 랜덤 — 사이드 높이를 한 줄만 쓰도록 나란히 둔다(fitSide가 재는 높이가 그만큼 줄어든다) */
.start-row {
  display: flex;
  gap: 8px;
}
.start-row .btn-start {
  flex: 1;
  min-width: 0;
}
/* 랜덤은 보조 동작 — 골드는 "내 포즈로 출제" 한 곳에만 남긴다 */
.btn-random {
  background: var(--bf-panel-2);
  border-color: var(--bf-border);
  color: var(--bf-text);
}
/* 연속 모드가 돌고 있는 동안은 이 버튼이 "지금 켜져 있음"을 겸한다 */
.btn-random.on {
  background: var(--bf-coral);
  border-color: #8a3f2c;
  color: #2a1a14;
}
.combo {
  margin-top: 4px;
  text-align: center;
  font-size: 13px;
  font-weight: 800;
  color: var(--bf-gold);
}
.combo small {
  font-size: 10px;
  font-weight: 400;
  color: var(--bf-muted);
}
.diff-buttons {
  display: flex;
  gap: 6px;
}
.diff-btn {
  flex: 1;
  padding: 8px 4px;
  background: var(--bf-panel-2);
  border: var(--bf-line);
  border-radius: var(--bf-radius-sm);
  color: var(--bf-text);
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
}
.diff-btn.active {
  background: var(--bf-gold);
  color: #221d1a;
  border-color: #8a6d33;
}
</style>
