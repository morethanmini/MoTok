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
import {
  GRADE_POINTS,
  gradeOf as gradeFromIou,
  holeMarginFor,
  judgeRound,
  poseDifficulty,
  scoreFor,
  type RoundJudgment,
} from './judge'
import { createStage, type Stage } from './stage'
import { createWall, type WallHandle } from './wall'
import { BodyFitAudio } from './audio'

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
  /** 게임④(-9): 출제자 관전 화면에 띄울 실시간 순위 — 부모의 scoreboardRows */
  scores?: { userId: string; nickname: string; holdProgress: number; finished: boolean; score: number | null }[]
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

const videoRef = ref<HTMLVideoElement>()
const glCanvasRef = ref<HTMLCanvasElement>()
const viewportRef = ref<HTMLDivElement>()
const pipOverlayRef = ref<HTMLCanvasElement>()
const thumbRef = ref<HTMLCanvasElement>()
/** 출제자 관전 화면의 큰 구멍 — 썸네일과 달리 "벽에 뚫린 구멍" 자체를 보여준다 */
const holeRef = ref<HTMLCanvasElement>()

/** stale = 벽 도착 후 다음 라운드 이벤트가 끊긴 상태(복구 대기) — 아래 STALE_MS 참고 */
type Phase = 'idle' | 'wait' | 'setting' | 'incoming' | 'result' | 'stale'
const phase = ref<Phase>('idle')
const round = ref(0)
const timerSec = ref(0)
const approachPct = ref(0)
const tracked = ref(false)
const camError = ref<string | null>(null)
const judgment = ref<RoundJudgment | null>(null)
/** 접근 중 실시간 판정(스로틀) — 게이지·빨강 세그먼트용 */
const liveIou = ref(0)
const totalScore = ref(0)
const history = ref<{ round: number; grade: Grade; iou: number }[]>([])

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
/** 라운드 사이 휴식(서버 startAt 전) 안내 — 다음이 누구 차례인지 알려준다 */
const waitCaption = computed(() => {
  if (!isMultiplayer.value) return '곧 시작합니다'
  return isSetter.value
    ? '내 차례! 포즈를 준비하세요'
    : `${props.setterName ?? '출제자'}님 차례입니다 — 준비하세요`
})
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

const phaseLabel = computed(() => {
  if (phase.value === 'wait') return waitCaption.value
  if (phase.value === 'setting') {
    if (!isMultiplayer.value || isSetter.value) return '포즈를 취하세요! 이 포즈가 벽 구멍이 됩니다'
    return '출제자가 포즈를 만드는 중 — 따라할 준비!'
  }
  if (phase.value === 'incoming') {
    // 게임④(-9) 룰: 출제자는 이번 라운드에 플레이하지 않고 관전만 한다
    if (isMultiplayer.value && isSetter.value) return '출제자는 관전 중 — 다른 사람들이 통과하는 걸 지켜보세요'
    return '벽이 다가옵니다 — 구멍에 맞추세요!'
  }
  if (phase.value === 'result') {
    if (isMultiplayer.value && isSetter.value) return '라운드 종료 — 다음 출제자를 기다립니다'
    return isMultiplayer.value && !props.results ? '집계 중…' : '판정!'
  }
  if (phase.value === 'stale') return '⚠ 라운드 정보를 못 받았어요 — 다음 라운드에 자동 복구됩니다'
  return tracked.value ? '시작을 누르면 3초 뒤 내 포즈가 벽이 됩니다' : '카메라 앞에 서주세요'
})

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
  rig = new AvatarRig(cfg.avatar)
  stage.scene.add(rig.group)
  stage.setFloorY(rig.floorY)
  wall = createWall()
  stage.scene.add(wall.mesh)
}

function startRound() {
  if (!tracked.value || phase.value === 'setting' || phase.value === 'incoming') return
  judgment.value = null
  liveIou.value = 0
  liveOverflow.value = []
  rig.setOverflow([])
  round.value += 1
  captureAt = performance.now() + 3000
  phase.value = 'setting'
}

function easeIn(t: number): number {
  return Math.pow(t, 2.5) // 막판 급가속 (UI 스펙 §7 근사)
}

/** 캡처된 출제 포즈를 좌상단 목표 썸네일에 그린다 (§6-7 — 벽이 다가오면 구멍이 안 보인다) */
function drawThumbnail(setter: SolvedSkeleton) {
  const canvas = thumbRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  drawSilhouette(ctx, setter, cfg, 0)
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

/** 실시간 판정(4Hz) — 게이지 갱신 + 삐져나온 세그먼트 즉시 빨강 (§7-4) */
function liveJudge(now: number) {
  if (setterPose && rig.lastSolved && now - lastLiveJudge > 250) {
    lastLiveJudge = now
    const live = judgeRound(rig.lastSolved, setterPose, holeMargin, cfg)
    liveIou.value = live.iou
    liveOverflow.value = live.overflow
    rig.setOverflow(live.overflow)
    // 별 개념이 없는 게임이라 starsLit=0, 일치율을 holdProgress(0~1)에 싣는다 —
    // 출제자 관전 화면과 방 스코어보드가 이 값으로 갱신된다
    if (isMultiplayer.value) emit('progress', 0, Math.min(1, live.iou / 100))
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
  if (phase.value === 'setting') {
    timerSec.value = Math.max(0, Math.ceil((captureAt - now) / 1000))
    if (now >= captureAt && rig.lastSolved) {
      setterPose = rig.lastSolved
      holeMargin = holeMarginFor(setterPose, cfg)
      wall.build(setterPose, holeMargin, cfg)
      wall.mesh.position.z = WALL_START_Z
      wall.mesh.visible = true
      adoptSetterPose(setterPose)
      approachStart = now
      lastLiveJudge = 0
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
    // 출제자: 마감 직전 프레임을 캡처해 전송 — 서버가 POSE_SET으로 전원에게 재방송
    if (isSetter.value && !poseSubmitted && srv >= settingEnd - 150 && lastSmoothed) {
      poseSubmitted = true
      emit('pose-submit', serializePose(lastSmoothed))
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
  if (isMultiplayer.value && props.session) tickMulti(performance.now())
  else tickSolo(performance.now())
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
    poseSubmitted = false
    finishedSent = false
    round.value = s.roundNo ?? 1
    if (wall) wall.mesh.visible = false
    rig?.setOverflow([])
  },
  { immediate: true },
)

// 멀티: POSE_SET 도착 → 전원이 같은 렌더 함수로 같은 벽을 만든다 (§9-2)
watch(
  () => props.challenge,
  (ch) => {
    if (!ch || !isMultiplayer.value || !wall) return
    try {
      const normalized = normalizePose(parsePose(ch), true)
      if (!normalized) return
      setterPose = solveSkeleton(normalized, cfg.avatar, createSkeletonState())
      holeMargin = holeMarginFor(setterPose, cfg)
      wall.build(setterPose, holeMargin, cfg)
      wall.mesh.position.z = WALL_START_Z
      wall.mesh.visible = true
      adoptSetterPose(setterPose)
      lastLiveJudge = 0
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
  else if (p === 'incoming')
    audio.play('approach', { tailMs: s ? s.endAt - srv : cfg.wall.approachMs })
  else if (p === 'result') audio.play('ingame', { loop: true })
  else audio.stop() // idle · stale
})

// 관전 화면의 구멍 캔버스는 v-if라 출제 포즈가 도착한 시점엔 아직 DOM에 없다 —
// 패널이 붙은 뒤 한 번 더 그린다(adoptSetterPose의 drawHole은 그때 no-op이었다).
watch(spectating, async (on) => {
  if (!on) return
  await nextTick()
  drawHole()
})

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
    await pose.start(props.video, onPose)
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
  await pose.start(video, onPose)
})

/** 게임룸이 게임 화면을 captureStream으로 송출할 수 있게 3D 캔버스를 노출 (게임① 패턴) */
defineExpose({ canvas: glCanvasRef })

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  clearInterval(phaseTimerId)
  audio.dispose()
  stream?.getTracks().forEach((t) => t.stop())
  resizeObs?.disconnect()
  rig?.dispose()
  wall?.dispose()
  stage?.dispose()
  stage = null
})
</script>

<template>
  <div class="game" :class="{ embedded }">
    <header class="topbar">
      <span class="pill round-pill">{{ round }}{{ totalRoundsLabel }} 라운드</span>
      <span class="pill phase-pill">{{ camError ?? phaseLabel }}</span>
      <span
        v-if="phase === 'wait' || phase === 'setting' || phase === 'incoming'"
        class="pill timer-pill"
        :class="{ urgent: phase === 'incoming' && timerSec <= 2 }"
        >00:{{ String(timerSec).padStart(2, '0') }}</span
      >
      <span class="pill setter-pill" :class="{ mine: isMultiplayer && isSetter }">
        👑 출제자 {{ setterLabel }}
      </span>
    </header>

    <div class="main">
      <div class="center">
        <div ref="viewportRef" class="viewport" :class="{ 'my-turn': myPoseTurn }">
          <!-- 관전 중에는 3D를 숨기기만 한다(v-if로 떼면 three.js 컨텍스트가 날아간다) -->
          <canvas v-show="!spectating" ref="glCanvasRef" class="gl-canvas"></canvas>

          <canvas
            v-show="phase === 'incoming' && !spectating"
            ref="thumbRef"
            class="thumb"
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
          </div>

          <div v-if="phase === 'incoming' && !spectating" class="approach-bar" :class="{ urgent: timerSec <= 2 }">
            <div class="fill" :style="{ width: approachPct + '%' }"></div>
          </div>

          <!-- 게임④(-9) 출제자 관전 화면 — 내가 낸 구멍이 주인공이고, 도전자는 그 옆 링으로 본다 -->
          <div v-if="spectating" class="spectate-panel">
            <p class="sp-title">🧱 내가 만든 구멍</p>

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

      <aside class="side">
        <!-- 내 캠 — 무대 위 PiP였으나 통과율 위(사이드 최상단)로 옮겼다(실기 피드백) -->
        <div class="pip">
          <video ref="videoRef" class="pip-video mirrored" muted playsinline></video>
          <canvas ref="pipOverlayRef" class="pip-overlay mirrored" width="640" height="480"></canvas>
          <span class="pip-label">● 내 캠 · {{ tracked ? '인식 중' : '인식 안 됨' }}</span>
        </div>

        <div v-if="isMultiplayer && isSetter" class="card gauge-card">
          <h3>상태</h3>
          <p class="spectate">👀 관전 중 — 이번 라운드는 안 뛰어요</p>
        </div>
        <div v-else class="card gauge-card">
          <h3>통과율</h3>
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
            <text x="60" y="64" class="gauge-num" :fill="GRADE_COLOR[gaugeGrade]">
              {{ Math.round(liveIou) }}<tspan class="pct">%</tspan>
            </text>
          </svg>
          <p class="gauge-hint">PASS {{ cfg.judge.grade.pass }} · GREAT {{ cfg.judge.grade.great }} · PERFECT {{ cfg.judge.grade.perfect }}</p>
        </div>

        <div v-if="overflowWarning && phase === 'incoming' && !(isMultiplayer && isSetter)" class="warn-box">
          ⚠ {{ overflowWarning }}
        </div>

        <div class="card score-card">
          <h3>내 점수</h3>
          <p class="score">{{ totalScore }}<small>점</small></p>
          <ul class="history">
            <li v-for="h in history.slice(0, 5)" :key="h.round">
              <span>{{ h.round }}R</span>
              <b :style="{ color: GRADE_COLOR[h.grade] }">{{ h.grade }}</b>
              <span>{{ h.iou.toFixed(0) }}%</span>
            </li>
          </ul>
        </div>

        <button
          v-if="!isMultiplayer"
          class="btn-start"
          :disabled="!tracked || phase === 'setting' || phase === 'incoming'"
          @click="startRound"
        >
          ▶ {{ round === 0 ? '시작' : '다음 라운드' }}
        </button>

        <div v-if="!isMultiplayer" class="card diff-card">
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
    <div v-if="results" class="results-overlay">
      <div class="results-card">
        <h2>🏁 라운드 결과</h2>
        <ol class="results-list">
          <li v-for="r in results" :key="r.userId" :class="{ me: r.userId === myUserId }">
            <span class="rank">{{ r.rank }}위</span>
            <span class="name">{{ r.nickname }}</span>
            <b class="pts">{{ r.score }}점</b>
          </li>
        </ol>
        <button class="btn-start" @click="emit('close')">닫기</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game {
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
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
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
  border: var(--bf-line);
  border-radius: var(--bf-radius);
  box-shadow: var(--bf-shadow);
  overflow: hidden;
  /* three.js scene.background(0x1a1411)와 같은 값 — 캔버스 로드 전 깜빡임 방지 */
  background: #1a1411;
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
/* 사이드 최상단 카드 — 무대 오버레이가 아니라 통과율 위에 놓인다 */
.pip {
  position: relative;
  flex-shrink: 0;
  /* 스켈레톤 오버레이가 4:3 비디오 위에 1:1로 얹히므로 비율은 건드리지 않고 폭만 줄인다
     (crop/letterbox를 넣으면 오버레이 좌표가 어긋난다) */
  width: 100%;
  max-width: 200px;
  margin: 0 auto;
  border: var(--bf-line);
  border-radius: var(--bf-radius);
  overflow: hidden;
  box-shadow: var(--bf-shadow-sm);
  background: #000;
}
.pip-video {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}
.pip-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: calc(100% - 22px);
  pointer-events: none;
}
.mirrored {
  transform: scaleX(-1);
}
.pip-label {
  display: block;
  padding: 3px 8px;
  background: var(--bf-panel);
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
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
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
  filter: drop-shadow(0 0 6px currentColor);
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
