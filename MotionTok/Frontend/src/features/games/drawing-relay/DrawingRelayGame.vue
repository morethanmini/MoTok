<script setup lang="ts">
/**
 * 그림으로 말해요 — 그림 이어그리기 + AI 블라인드 채점.
 *
 * 총 4분을 인원수로 나눠(올림) 한 명씩 같은 도화지에 이어 그리고, 완성 그림을
 * GMS 비전 모델에 주제어 없이 보내 "무엇을 그린 것인지" 5개 추측을 받는다.
 * 주제어가 추측 순위에 들면 순위별 점수(1순위 100 … 5순위 20).
 *
 * 조작(MediaPipe): 펜 손(기본 오른손)은 엄지+검지 핀치로 그리고 손을 펴면 이동,
 * 지우개 손(기본 왼손)은 주먹을 쥐고 문지르면 지운다 — 왼손잡이 모드로 역할 스왑.
 * 두 손은 각자 상태(스무딩·히스테리시스·진행 중 획)를 갖고 동시에 동작할 수 있다.
 * 펜 끝은 엄지·검지 중점을 써 손을 펴는 순간의 이동을 줄이고, 전환 프레임 동안
 * 그려지는 꼬리는 획을 점 목록으로 보관했다가 펜 업 시점에 소급 삭제한다(trimStrokeTail).
 * 카메라가 없으면 마우스/터치로도 그릴 수 있다(✏️/🧽 토글, 로컬 테스트 폴백).
 *
 * 모드 두 가지:
 * - 솔로(session=null 또는 turnOrder 없음): 혼자서 n명 몫의 차례를 이어 그린다(로컬 타이머).
 * - 멀티(session.turnOrder 제공, 명세 v0.2.20): 서버가 준 주제어·화가 순서·턴 스케줄을
 *   전 클라이언트가 서버 권위 시각으로 동일 계산한다(턴 전환 이벤트 없음). 내 차례에만
 *   입력이 열리고, 획 연산을 100ms 배치로 발신(draw emit → STOMP DRAW 릴레이)해 전원이
 *   같은 도화지를 실시간으로 본다. 마지막 화가가 GMS 채점 후 결과를 발신(drawResult emit)
 *   → DRAW_RESULT 에코를 전원이 받아 같은 결과 화면으로 전환한다.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DrawOp, GameEvent, GameResultEntry } from '@/api/types'
import { useHandLandmarker, type HandLandmarkerResult } from '@/composables/useHandLandmarker'
import type { ActiveGameSession } from '../session'
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  PEN_TIP_INDEX,
  applyPinchHysteresis,
  computeTurnSeconds,
  findAnswerRank,
  handRole,
  isFist,
  knuckleCenter,
  pinchMidpoint,
  pinchRatio,
  scoreForRank,
  trimStrokeTail,
  type NormalizedPoint,
  type StrokePoint,
} from './logic'
import { pickTopic } from './words'
import { judgeDrawing, type JudgeResult } from './scoring'

const props = defineProps<{
  /** 게임룸 셀프 타일의 <video> — 스트림이 attach되어 재생 중이어야 한다 */
  video: HTMLVideoElement | null
  /** 멀티플레이 세션(GAME_START). turnOrder가 있으면 멀티, 없으면 솔로 모드 */
  session?: ActiveGameSession | null
  /** 멀티 GAME_END — DRAW_RESULT 없이 타임아웃 정산됐을 때의 폴백 신호로만 쓴다 */
  results?: GameResultEntry[] | null
  myUserId?: string | null
  /** 멀티 DRAW/DRAW_RESULT 릴레이 피드(게임룸이 수신 순서대로 append) */
  drawEvents?: GameEvent[] | null
}>()
const emit = defineEmits<{
  close: []
  /** 멀티: 내 차례의 획 연산 배치(100ms 플러시) — 부모가 STOMP /game/draw로 발신 */
  draw: [seq: number, ops: DrawOp[]]
  /** 멀티: AI 채점 결과 — 부모가 STOMP /game/draw-result로 발신 */
  drawResult: [payload: { guesses: string[]; answerRank: number; score: number }]
}>()

/** 도화지 논리 해상도 — 카메라 해상도와 무관하게 고정 */
const W = 960
const H = 540
const HANDOVER_SECONDS = 3
/** 손 좌표 EMA 스무딩 계수 (1에 가까울수록 반응 빠름·떨림 큼) */
const SMOOTHING = 0.45
const PEN_COLOR = '#26262e'
const PEN_WIDTH = 5
const PAPER_COLOR = '#fdfdf8'
const ERASER_WIDTH = 36
/** 주먹(지우개) 전환에 필요한 연속 프레임 수 — 순간 오인식으로 지워지는 것 방지 */
const FIST_CONFIRM_FRAMES = 3

const hand = useHandLandmarker()
const canvasRef = ref<HTMLCanvasElement>()
/** 부모(게임룸)가 게임 화면을 captureStream으로 송출할 수 있게 캔버스를 노출 */
defineExpose({ canvas: canvasRef })

// ── 도화지 (그려진 획만 보관 — 채점 시 이 캔버스를 그대로 내보낸다) ──
const paper = document.createElement('canvas')
paper.width = W
paper.height = H
const paperCtx = paper.getContext('2d')!

// 획을 점 목록으로도 보관한다 — 펜을 놓는 순간 꼬리 점을 소급 삭제(trimStrokeTail)하고
// 도화지를 다시 그리기 위해. 지우개는 도화지색 굵은 획이라 같은 구조로 함께 저장된다.
type Tool = 'pen' | 'erase'
interface Stroke {
  tool: Tool
  points: StrokePoint[]
}
let strokes: Stroke[] = []

/** 진행 중인 획의 소유자 — 펜 손·지우개 손·마우스가 각자 하나씩 갖는다(동시 사용 가능) */
interface StrokeSource {
  stroke: Stroke | null
}
clearPaper()

function clearPaper() {
  paperCtx.fillStyle = PAPER_COLOR
  paperCtx.fillRect(0, 0, W, H)
}
function resetPaper() {
  strokes = []
  penHand.stroke = null
  eraseHand.stroke = null
  mouse.stroke = null
  clearPaper()
}

// ── 게임 상태 ─────────────────────────────────
const phase = ref<'ready' | 'handover' | 'drawing' | 'judging' | 'result'>('ready')
const playerCount = ref(MIN_PLAYERS)
const topic = ref('')
const turnIndex = ref(0)
const timeLeft = ref(0)
const handoverLeft = ref(HANDOVER_SECONDS)

// ── 멀티 (명세 v0.2.20 — 서버 스케줄 계산·획 릴레이) ──
const isMultiplayer = computed(() => !!props.session?.turnOrder?.length)
const turnSeconds = computed(() =>
  isMultiplayer.value
    ? (props.session!.turnDurationSec ?? computeTurnSeconds(playerCount.value))
    : computeTurnSeconds(playerCount.value),
)
const mpHandoverSec = computed(() => props.session?.handoverSec ?? HANDOVER_SECONDS)
/** 지금(또는 다가오는) 차례가 내 차례인지 */
const myTurn = computed(
  () => isMultiplayer.value && props.session!.turnOrder![turnIndex.value] === props.myUserId,
)
const amLastPainter = computed(() => {
  const order = props.session?.turnOrder
  return !!order?.length && order[order.length - 1] === props.myUserId
})
/** 채점 대기 경과(초) — 관전자 폴백 채점 버튼 노출 판단 */
const resultWaitSec = ref(0)
const showJudgeFallback = computed(
  () => isMultiplayer.value && !amLastPainter.value && resultWaitSec.value >= 20,
)

/** 멀티: 서버 보정 시각. 솔로에서는 사용하지 않는다. */
function serverNow(): number {
  return Date.now() + (props.session?.clockOffset ?? 0)
}

/** 왼손잡이 모드 — 펜(기본 오른손)/지우개(기본 왼손) 역할을 서로 바꾼다 */
const swapHands = ref(false)
const penHandLabel = computed(() => (swapHands.value ? '왼손' : '오른손'))
const eraseHandLabel = computed(() => (swapHands.value ? '오른손' : '왼손'))
const penDetected = ref(false)
const penDrawing = ref(false)
const eraseDetected = ref(false)
const erasing = ref(false)
/** 마우스 폴백용 도구 (✏️/🧽 토글) — 손 제스처에는 영향 없다 */
const mouseTool = ref<Tool>('pen')
const mouseDrawing = ref(false)
const mouseOver = ref(false)
/** 새 비디오 프레임이 한 번이라도 들어왔는지 — 아니면 "마우스로 그리기" 안내 */
const gotFrame = ref(false)

const judgeResult = ref<JudgeResult | null>(null)
const judgeError = ref<string | null>(null)
const answerRank = ref(0)
const finalScore = ref(0)
const finalImage = ref('')

// 프레임마다 바뀌는 값은 반응성 없이 보관 (렌더 루프 전용)
/** 손 하나의 프레임 상태 — 펜 손과 지우개 손이 각자 하나씩 갖는다 */
interface HandState extends StrokeSource {
  x: number
  y: number
  tracked: boolean
  fistStreak: number
  looseStreak: number
  fist: boolean
  /** 펜 손: 핀치 다운 / 지우개 손: 주먹 확정 */
  active: boolean
}
function freshHand(): HandState {
  return {
    x: W / 2, y: H / 2, tracked: false,
    fistStreak: 0, looseStreak: 0, fist: false,
    active: false, stroke: null,
  }
}
const penHand = freshHand()
const eraseHand = freshHand()
const mouse: StrokeSource & { x: number; y: number } = { x: W / 2, y: H / 2, stroke: null }
let handoverDeadline = 0
let turnDeadline = 0

// ── 멀티 획 릴레이 상태 ──
/** 내 차례에 쌓는 발신 대기 획 연산 — 100ms 간격으로 draw emit */
let outbox: DrawOp[] = []
let drawSeq = 0
/** drawEvents 피드에서 처리한 위치 */
let lastAppliedDrawIndex = 0
let mpJudgingStarted = false
/** 원격 화가별 진행 중/직전 획 — trim(꼬리 삭제) 적용 대상 추적 */
interface RemoteSource extends StrokeSource {
  lastEnded: Stroke | null
}
const remoteStrokes = new Map<string, RemoteSource>()

/** 내 차례(멀티)에만 획 연산을 발신 큐에 쌓는다 */
function pushOp(op: DrawOp) {
  if (isMultiplayer.value && myTurn.value) outbox.push(op)
}
function flushOutbox() {
  if (!outbox.length) return
  drawSeq += 1
  emit('draw', drawSeq, outbox)
  outbox = []
}

// ── 인식 루프 연결 — 비디오가 준비되면 항상 돌린다(대기 화면에서도 상태가 보이게) ──
watch(
  () => props.video,
  (video) => {
    hand.stop()
    if (video) void hand.start(video, onFrame)
  },
  { immediate: true },
)

// ── 타이머(인터벌) + 렌더(RAF) 루프 — 카메라 프레임과 독립(마우스 폴백에서도 동작).
// 단계 전환을 RAF에 태우면 탭이 가려질 때 RAF가 멈춰 게임이 정지하므로,
// 전환은 인터벌로 구동하고 RAF는 화면 갱신만 맡는다(핑거 스타 멀티 타이머와 같은 구조).
let rafId = 0
let phaseTicker = 0
onMounted(() => {
  phaseTicker = window.setInterval(() => {
    if (isMultiplayer.value) {
      mpTick()
      flushOutbox()
      return
    }
    const now = performance.now()
    if (phase.value === 'handover') {
      handoverLeft.value = Math.max(1, Math.ceil((handoverDeadline - now) / 1000))
      if (now >= handoverDeadline) beginTurn()
    } else if (phase.value === 'drawing') {
      timeLeft.value = Math.max(0, (turnDeadline - now) / 1000)
      if (now >= turnDeadline) endTurn()
    }
  }, 100)
  const tick = () => {
    rafId = requestAnimationFrame(tick)
    render()
  }
  tick()
})
onBeforeUnmount(() => {
  hand.stop()
  clearInterval(phaseTicker)
  cancelAnimationFrame(rafId)
})

// ── 멀티 상태 머신 — 서버 스케줄(startAt + 턴×(교대+그리기))을 전 클라이언트가 동일 계산 ──
watch(
  () => props.session,
  (session) => {
    if (!session?.turnOrder?.length) {
      phase.value = 'ready'
      return
    }
    topic.value = session.topicWord ?? '???'
    playerCount.value = session.turnOrder.length
    resetPaper()
    remoteStrokes.clear()
    outbox = []
    drawSeq = 0
    lastAppliedDrawIndex = 0
    mpJudgingStarted = false
    judgeResult.value = null
    judgeError.value = null
    answerRank.value = 0
    finalScore.value = 0
    finalImage.value = ''
    resultWaitSec.value = 0
    turnIndex.value = 0
    phase.value = 'handover'
    mpTick()
  },
  { immediate: true },
)

function mpTick() {
  const s = props.session
  if (!s?.turnOrder?.length || phase.value === 'result') return
  const now = serverNow()
  const h = mpHandoverSec.value * 1000
  const slot = h + turnSeconds.value * 1000
  const n = s.turnOrder.length
  const elapsed = now - s.startAt
  if (phase.value === 'judging') {
    resultWaitSec.value = Math.max(0, Math.round((elapsed - n * slot) / 1000))
    return
  }
  if (elapsed >= n * slot) {
    beginMpJudging()
    return
  }
  const idx = Math.max(0, Math.floor(elapsed / slot))
  if (idx !== turnIndex.value) {
    endAllStrokes()
    beep(660)
    turnIndex.value = idx
  }
  const within = elapsed - idx * slot
  if (within < h) {
    // 시작 전 카운트다운(elapsed<0)도 첫 교대 화면에 합쳐서 보여준다
    phase.value = 'handover'
    handoverLeft.value = Math.max(1, Math.ceil((h - within) / 1000))
  } else {
    phase.value = 'drawing'
    timeLeft.value = Math.max(0, (slot - within) / 1000)
  }
}

/** 모든 턴 종료 → 채점 단계. 마지막 화가만 GMS를 호출하고 결과는 전원이 에코로 받는다. */
function beginMpJudging() {
  if (mpJudgingStarted) return
  mpJudgingStarted = true
  endAllStrokes()
  flushOutbox()
  phase.value = 'judging'
  finalImage.value = paper.toDataURL('image/png')
  if (amLastPainter.value) void judgeMp()
}

async function judgeMp() {
  judgeError.value = null
  try {
    const r = await judgeDrawing(finalImage.value, topic.value)
    const rank = findAnswerRank(topic.value, r.guesses)
    // 화면 전환은 DRAW_RESULT 에코 수신 시 — 전원이 같은 경로로 결과를 본다
    emit('drawResult', { guesses: r.guesses, answerRank: rank, score: scoreForRank(rank) })
  } catch (e) {
    judgeError.value = e instanceof Error ? e.message : 'AI 채점에 실패했어요'
  }
}

function retryJudge() {
  if (isMultiplayer.value) void judgeMp()
  else void judge()
}

// ── 멀티 릴레이 수신 — DRAW(원격 획 적용)·DRAW_RESULT(결과 화면 전환) ──
watch(
  () => props.drawEvents?.length ?? 0,
  (len) => {
    const events = props.drawEvents ?? []
    if (len < lastAppliedDrawIndex) lastAppliedDrawIndex = 0 // 피드 리셋(새 세션) 방어
    for (; lastAppliedDrawIndex < len; lastAppliedDrawIndex++) {
      const e = events[lastAppliedDrawIndex]!
      if (e.type === 'DRAW') {
        if (e.userId !== props.myUserId) applyRemoteOps(e.userId, e.ops)
      } else if (e.type === 'DRAW_RESULT') {
        applyDrawResult(e.guesses, e.answerRank, e.score)
      }
    }
  },
)

/** 원격 화가의 획 연산 적용 — 로컬 입력과 같은 도화지·획 목록을 공유한다(이어받기 자동) */
function applyRemoteOps(userId: string, ops: DrawOp[]) {
  let src = remoteStrokes.get(userId)
  if (!src) {
    src = { stroke: null, lastEnded: null }
    remoteStrokes.set(userId, src)
  }
  for (const op of ops) {
    if (op.type === 'begin') {
      const tool: Tool = op.tool === 'erase' ? 'erase' : 'pen'
      const x = op.x ?? 0
      const y = op.y ?? 0
      src.stroke = { tool, points: [{ x, y, t: performance.now() }] }
      strokes.push(src.stroke)
      drawDot(x, y, tool)
    } else if (op.type === 'point') {
      const s = src.stroke
      if (!s) continue
      const prev = s.points[s.points.length - 1]!
      const x = op.x ?? prev.x
      const y = op.y ?? prev.y
      s.points.push({ x, y, t: performance.now() })
      drawSegment(prev, { x, y }, s.tool)
    } else if (op.type === 'end') {
      if (src.stroke) src.lastEnded = src.stroke
      src.stroke = null
    } else if (op.type === 'trim') {
      // 화가의 펜 업 꼬리 삭제 동기화 — 직전 획을 x개 점으로 절단하고 다시 그린다
      const target = src.stroke ?? src.lastEnded
      const keep = Math.max(1, Math.floor(op.x ?? 1))
      if (target && target.points.length > keep) {
        target.points = target.points.slice(0, keep)
        rebuildPaper()
      }
    }
  }
}

/** DRAW_RESULT 수신 — 전원 동일 결과 화면. 채점 주체가 모의 채점이었는지는 전달되지 않는다. */
function applyDrawResult(guesses: string[], rank: number, score: number) {
  judgeResult.value = { guesses, source: 'gms' }
  answerRank.value = rank
  finalScore.value = score
  if (!finalImage.value) finalImage.value = paper.toDataURL('image/png')
  phase.value = 'result'
  beep(880)
}

// DRAW_RESULT 없이 서버 타임아웃 정산(GAME_END)만 온 경우 — 미채점 0점으로 마감
watch(
  () => props.results,
  (results) => {
    if (!results || !isMultiplayer.value || judgeResult.value) return
    judgeResult.value = { guesses: [], source: 'gms' }
    answerRank.value = 0
    finalScore.value = 0
    if (!finalImage.value) finalImage.value = paper.toDataURL('image/png')
    phase.value = 'result'
  },
)

// ── 진행 흐름 ─────────────────────────────────
function startGame() {
  topic.value = pickTopic()
  resetPaper()
  turnIndex.value = 0
  judgeResult.value = null
  judgeError.value = null
  answerRank.value = 0
  finalScore.value = 0
  finalImage.value = ''
  startHandover()
}

function startHandover() {
  endAllStrokes()
  phase.value = 'handover'
  handoverLeft.value = HANDOVER_SECONDS
  handoverDeadline = performance.now() + HANDOVER_SECONDS * 1000
}

function beginTurn() {
  phase.value = 'drawing'
  timeLeft.value = turnSeconds.value
  turnDeadline = performance.now() + turnSeconds.value * 1000
}

/** 시간 만료 또는 "차례 마치기" — 다음 화가로 넘기거나 채점으로 */
function endTurn() {
  endAllStrokes()
  if (turnIndex.value + 1 < playerCount.value) {
    turnIndex.value += 1
    beep(660)
    startHandover()
    return
  }
  finishDrawing()
}

function finishDrawing() {
  phase.value = 'judging'
  finalImage.value = paper.toDataURL('image/png')
  void judge()
}

async function judge() {
  judgeError.value = null
  try {
    const r = await judgeDrawing(finalImage.value, topic.value)
    judgeResult.value = r
    answerRank.value = findAnswerRank(topic.value, r.guesses)
    finalScore.value = scoreForRank(answerRank.value)
    phase.value = 'result'
    beep(880)
  } catch (e) {
    judgeError.value = e instanceof Error ? e.message : 'AI 채점에 실패했어요'
  }
}

// ── 그리기 (도화지에 획 누적) ─────────────────
function toolStyle(tool: Tool): { color: string; width: number } {
  return tool === 'erase'
    ? { color: PAPER_COLOR, width: ERASER_WIDTH }
    : { color: PEN_COLOR, width: PEN_WIDTH }
}
function drawDot(x: number, y: number, tool: Tool) {
  const s = toolStyle(tool)
  paperCtx.fillStyle = s.color
  paperCtx.beginPath()
  paperCtx.arc(x, y, s.width / 2, 0, Math.PI * 2)
  paperCtx.fill()
}
function drawSegment(a: { x: number; y: number }, b: { x: number; y: number }, tool: Tool) {
  const s = toolStyle(tool)
  paperCtx.strokeStyle = s.color
  paperCtx.lineWidth = s.width
  paperCtx.lineCap = 'round'
  paperCtx.lineJoin = 'round'
  paperCtx.beginPath()
  paperCtx.moveTo(a.x, a.y)
  paperCtx.lineTo(b.x, b.y)
  paperCtx.stroke()
}

function drawTo(src: StrokeSource, x: number, y: number, tool: Tool) {
  if (src.stroke && src.stroke.tool !== tool) endStroke(src)
  const t = performance.now()
  if (!src.stroke) {
    src.stroke = { tool, points: [{ x, y, t }] }
    strokes.push(src.stroke)
    drawDot(x, y, tool)
    pushOp({ type: 'begin', tool, x, y })
    return
  }
  const prev = src.stroke.points[src.stroke.points.length - 1]!
  src.stroke.points.push({ x, y, t })
  drawSegment(prev, { x, y }, tool)
  pushOp({ type: 'point', x, y })
}

/** 소스의 획 종료. trimTail이면(손 제스처 펜 업) 놓는 동안 그려진 꼬리 점을 소급 삭제한다. */
function endStroke(src: StrokeSource, trimTail = false) {
  const s = src.stroke
  if (!s) return
  pushOp({ type: 'end' })
  if (trimTail && s.tool === 'pen') {
    const trimmed = trimStrokeTail(s.points, performance.now())
    if (trimmed.length !== s.points.length) {
      s.points = trimmed
      rebuildPaper()
      // 관전자도 같은 꼬리 삭제를 하도록 남길 점 수를 알린다(직전 획 대상)
      pushOp({ type: 'trim', x: trimmed.length })
    }
  }
  src.stroke = null
}

/** 모든 입력 소스의 획 종료 — 차례 전환·게임 종료 시(타이머가 끊은 획은 꼬리 삭제 없음) */
function endAllStrokes() {
  endStroke(penHand)
  endStroke(eraseHand)
  endStroke(mouse)
}

/** 획 목록으로 도화지 재구성 — 꼬리 삭제 직후에만 호출된다(매 프레임 아님) */
function rebuildPaper() {
  clearPaper()
  for (const s of strokes) {
    const first = s.points[0]
    if (!first) continue
    drawDot(first.x, first.y, s.tool)
    for (let i = 1; i < s.points.length; i++) drawSegment(s.points[i - 1]!, s.points[i]!, s.tool)
  }
}

// ── 손 프레임 처리 — 좌/우 라벨로 펜 손·지우개 손을 나눠 각각 갱신 ──
function onFrame(result: HandLandmarkerResult) {
  gotFrame.value = true
  const landmarksList = result.landmarks ?? []
  const handednessList = result.handedness ?? []
  let penLm: NormalizedPoint[] | null = null
  let eraseLm: NormalizedPoint[] | null = null
  landmarksList.forEach((lm, i) => {
    const role = handRole(handednessList[i]?.[0]?.categoryName, swapHands.value)
    if (role === 'pen' && !penLm) penLm = lm
    else if (role === 'erase' && !eraseLm) eraseLm = lm
  })
  updatePenHand(penLm)
  updateEraseHand(eraseLm)
}

/** 좌표 EMA 스무딩 — 첫 프레임은 즉시 따라잡고 이후엔 서서히 수렴 */
function track(h: HandState, tx: number, ty: number) {
  if (!h.tracked) {
    h.x = tx
    h.y = ty
    h.tracked = true
  } else {
    h.x += (tx - h.x) * SMOOTHING
    h.y += (ty - h.y) * SMOOTHING
  }
}

/** 주먹 여부를 연속 프레임 확인으로 확정 — 순간 오인식을 걸러낸다 */
function updateFist(h: HandState, lm: NormalizedPoint[]) {
  if (isFist(lm)) {
    h.fistStreak++
    h.looseStreak = 0
    if (h.fistStreak >= FIST_CONFIRM_FRAMES) h.fist = true
  } else {
    h.looseStreak++
    h.fistStreak = 0
    if (h.looseStreak >= FIST_CONFIRM_FRAMES) h.fist = false
  }
}

/** 지금 그릴 권한 — 멀티에서는 내 차례에만 입력이 열린다(관전자는 커서·상태만 표시) */
function inputAllowed(): boolean {
  return !isMultiplayer.value || myTurn.value
}

/** 손이 화면에서 사라졌을 때의 상태 정리 */
function resetHand(h: HandState, trimTail: boolean) {
  endStroke(h, trimTail)
  h.active = false
  h.tracked = false
  h.fistStreak = 0
  h.looseStreak = 0
  h.fist = false
}

function updatePenHand(lm: NormalizedPoint[] | null) {
  if (!lm || !lm[PEN_TIP_INDEX]) {
    penDetected.value = false
    penDrawing.value = false
    // 손이 프레임 밖으로 나가는 동작도 꼬리를 남기므로 소급 삭제
    resetHand(penHand, true)
    return
  }
  penDetected.value = true

  // 펜 끝 = 엄지·검지 중점 — 손을 펼 때 두 손가락이 반대로 벌어져 중점은 거의 안 움직인다.
  // 셀프 뷰가 scaleX(-1) 미러링이므로 x를 뒤집어 화면에 보이는 손 위치와 일치시킨다.
  const tip = pinchMidpoint(lm) ?? lm[PEN_TIP_INDEX]!
  track(penHand, (1 - tip.x) * W, tip.y * H)
  updateFist(penHand, lm)

  // 주먹은 엄지·검지 끝도 가까워 핀치로 읽히므로, 펜 손이 주먹인 동안은 펜을 잠근다
  const down = !penHand.fist && applyPinchHysteresis(penHand.active, pinchRatio(lm))
  const canAct = phase.value === 'drawing' && !mouseDrawing.value && inputAllowed()
  if (down && canAct) {
    drawTo(penHand, penHand.x, penHand.y, 'pen')
  } else {
    // 펜을 놓는 순간 — 손을 펴는 동안 그려진 꼬리를 소급 삭제
    endStroke(penHand, true)
  }
  penHand.active = down
  penDrawing.value = down && canAct
}

function updateEraseHand(lm: NormalizedPoint[] | null) {
  const center = lm ? knuckleCenter(lm) : null
  if (!lm || !center) {
    eraseDetected.value = false
    erasing.value = false
    resetHand(eraseHand, false)
    return
  }
  eraseDetected.value = true
  track(eraseHand, (1 - center.x) * W, center.y * H)
  updateFist(eraseHand, lm)

  const canAct = phase.value === 'drawing' && !mouseDrawing.value && inputAllowed()
  if (eraseHand.fist && canAct) drawTo(eraseHand, eraseHand.x, eraseHand.y, 'erase')
  else endStroke(eraseHand)
  eraseHand.active = eraseHand.fist
  erasing.value = eraseHand.fist && canAct
}

// ── 마우스/터치 폴백 (카메라 없이 로컬 테스트) ──
/** 클라이언트 좌표 → 캔버스 논리 좌표 (object-fit: contain 레터박스 보정) */
function canvasPoint(e: PointerEvent): { x: number; y: number } | null {
  const c = canvasRef.value
  if (!c) return null
  const rect = c.getBoundingClientRect()
  const scale = Math.min(rect.width / W, rect.height / H)
  if (scale <= 0) return null
  const x = (e.clientX - rect.left - (rect.width - W * scale) / 2) / scale
  const y = (e.clientY - rect.top - (rect.height - H * scale) / 2) / scale
  if (x < 0 || y < 0 || x > W || y > H) return null
  return { x, y }
}

function onPointerDown(e: PointerEvent) {
  if (phase.value !== 'drawing' || !inputAllowed()) return
  const p = canvasPoint(e)
  if (!p) return
  try {
    canvasRef.value?.setPointerCapture(e.pointerId)
  } catch {
    /* 활성 포인터가 없으면(합성 이벤트 등) 캡처 없이 진행 */
  }
  mouseDrawing.value = true
  mouse.x = p.x
  mouse.y = p.y
  endStroke(mouse)
  drawTo(mouse, p.x, p.y, mouseTool.value)
}
function onPointerMove(e: PointerEvent) {
  if (phase.value !== 'drawing' || !inputAllowed()) return
  const p = canvasPoint(e)
  if (!p) {
    mouseOver.value = false
    return
  }
  mouseOver.value = true
  mouse.x = p.x
  mouse.y = p.y
  if (mouseDrawing.value) drawTo(mouse, p.x, p.y, mouseTool.value)
}
function onPointerUp() {
  if (!mouseDrawing.value) return
  mouseDrawing.value = false
  endStroke(mouse) // 마우스는 놓는 즉시 멈추므로 꼬리 삭제가 필요 없다
}
function onPointerLeave() {
  mouseOver.value = false
}

// ── 렌더링 (도화지 + 펜/지우개 커서) ──────────
function render() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.drawImage(paper, 0, 0)

  if (phase.value !== 'drawing') return
  // 지우개 손 커서 — 주먹이면 활성 표시, 아니면 위치 예고
  if (eraseDetected.value) drawEraserCursor(ctx, eraseHand.x, eraseHand.y, erasing.value)
  // 펜 손 커서
  if (penDetected.value) drawPenCursor(ctx, penHand.x, penHand.y, penDrawing.value)
  // 손이 안 보일 때는 마우스 커서(드래그 중·호버 미리보기)
  if (!penDetected.value && !eraseDetected.value && (mouseDrawing.value || mouseOver.value)) {
    if (mouseTool.value === 'erase') drawEraserCursor(ctx, mouse.x, mouse.y, mouseDrawing.value)
    else drawPenCursor(ctx, mouse.x, mouse.y, mouseDrawing.value)
  }
}

/** 지우개 커서 — 지워질 반경을 그대로 보여준다 */
function drawEraserCursor(ctx: CanvasRenderingContext2D, x: number, y: number, active: boolean) {
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.65)'
  ctx.strokeStyle = active ? '#e0642f' : 'rgba(38,38,46,0.55)'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.arc(x, y, ERASER_WIDTH / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawPenCursor(ctx: CanvasRenderingContext2D, x: number, y: number, down: boolean) {
  ctx.save()
  if (down) {
    ctx.fillStyle = '#ff5d73'
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = down ? '#ff5d73' : 'rgba(38,38,46,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, 10, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// ── 효과음 ────────────────────────────────────
let audioCtx: AudioContext | null = null
function beep(freq = 660, dur = 0.08) {
  try {
    audioCtx = audioCtx ?? new AudioContext()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'triangle'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.18, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur)
    o.connect(g)
    g.connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + dur)
  } catch {
    /* 오디오 미지원 환경 무시 */
  }
}

const playerOptions = Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1)
</script>

<template>
  <div class="dr-shell">
    <canvas
      ref="canvasRef"
      class="dr-canvas"
      :width="W"
      :height="H"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
    />

    <!-- 상단 바: 주제어 · 화가 순번 · 턴 타이머 -->
    <div class="dr-topbar">
      <span class="dr-topic">🎨 주제어: {{ phase === 'ready' ? '???' : topic }}</span>
      <span class="dr-painter">
        화가 {{ turnIndex + 1 }} / {{ playerCount
        }}{{ isMultiplayer ? (myTurn ? ' · 내 차례!' : ' · 관전 중') : '' }}
      </span>
      <div class="dr-time-track">
        <div
          class="dr-time-fill"
          :style="{ width: `${phase === 'drawing' ? (timeLeft / turnSeconds) * 100 : 0}%` }"
        />
      </div>
      <span class="dr-timer">{{ phase === 'drawing' ? timeLeft.toFixed(0) + 's' : '--' }}</span>
      <button class="dr-close" title="게임 종료" @click="emit('close')">✕</button>
    </div>

    <!-- 하단 바: 손 인식·도구 상태 · 마우스 도구 토글 · 차례 마치기 -->
    <div class="dr-bottombar">
      <span :class="{ on: penDetected }">
        ✏️ 펜·{{ penHandLabel }} {{ penDetected ? (penDrawing ? '그리는 중' : '이동') : '—' }}
      </span>
      <span :class="{ on: erasing }">
        🧽 지우개·{{ eraseHandLabel }} {{ eraseDetected ? (erasing ? '지우는 중' : '대기') : '—' }}
      </span>
      <span v-if="!gotFrame" class="dr-hint">카메라가 없어도 마우스로 그릴 수 있어요</span>
      <!-- 마우스 도구·차례 넘기기 — 멀티 관전자에게는 숨김(입력 불가), 차례 넘기기는 솔로 전용
           (멀티는 서버 스케줄이 권위라 조기 종료 없음 — 명세 v0.2.20 후속 검토) -->
      <template v-if="phase === 'drawing' && (!isMultiplayer || myTurn)">
        <span class="dr-tools" :title="`마우스 도구 (손: ${penHandLabel} 핀치=펜 · ${eraseHandLabel} 주먹=지우개)`">
          <button class="dr-tool" :class="{ on: mouseTool === 'pen' }" @click="mouseTool = 'pen'">✏️</button>
          <button class="dr-tool" :class="{ on: mouseTool === 'erase' }" @click="mouseTool = 'erase'">🧽</button>
        </span>
        <button v-if="!isMultiplayer" class="dr-pass" @click="endTurn">
          {{ turnIndex + 1 < playerCount ? '차례 마치기 ▶' : '완성! 채점하기 ▶' }}
        </button>
      </template>
    </div>

    <!-- 대기 화면: 규칙 + 인원 선택(솔로 로컬 테스트) -->
    <div v-if="phase === 'ready'" class="dr-overlay">
      <p class="dr-guide">
        총 4분을 인원수로 나눠 한 도화지에 그림을 이어 그려요.<br />
        <b>{{ penHandLabel }}</b> 엄지+검지를 <b>집으면</b> 그리기 · 펴면 이동,
        <b>{{ eraseHandLabel }} 주먹</b>으로 문지르면 지우개!<br />
        완성 그림을 본 AI의 추측 5개 안에 주제어가 있으면 점수!
      </p>
      <div class="dr-players">
        <button
          v-for="n in playerOptions"
          :key="n"
          :class="{ on: n === playerCount }"
          @click="playerCount = n"
        >
          {{ n }}인
        </button>
      </div>
      <p class="dr-sub">
        인당 {{ turnSeconds }}초 × {{ playerCount }}명 — 정식 게임은 {{ MIN_PLAYERS }}인부터,
        로컬 테스트는 혼자 모든 차례를 그려요
      </p>
      <label class="dr-swap">
        <input v-model="swapHands" type="checkbox" />
        왼손잡이 모드 — 왼손 펜 · 오른손 지우개
      </label>
      <button class="dr-start" @click="startGame">🖌 그리기 시작</button>
      <p v-if="hand.error.value" class="dr-warn">{{ hand.error.value }} — 마우스로 그릴 수 있어요</p>
      <p v-else-if="hand.isLoading.value" class="dr-warn">손 인식 모델 로딩 중…</p>
      <p v-else-if="!gotFrame" class="dr-warn">카메라 대기 중 — 마우스로도 그릴 수 있어요</p>
    </div>

    <!-- 차례 교대 -->
    <div v-if="phase === 'handover'" class="dr-overlay dr-overlay-light">
      <p class="dr-guide">
        <b>{{ turnIndex + 1 }}번째 화가</b> 차례!<br />주제어: <b>{{ topic }}</b>
      </p>
      <p class="dr-countdown">{{ handoverLeft }}</p>
      <p class="dr-sub">
        {{
          isMultiplayer
            ? myTurn
              ? '내 차례예요 — 이어서 그려주세요!'
              : '다른 화가가 이어 그려요 — 같은 도화지가 실시간으로 보여요'
            : `이어서 그려주세요 — 인당 ${turnSeconds}초`
        }}
      </p>
    </div>

    <!-- AI 채점 중 -->
    <div v-if="phase === 'judging'" class="dr-overlay">
      <template v-if="!judgeError">
        <p class="dr-guide">🤖 AI가 그림을 살펴보는 중…</p>
        <p class="dr-sub">
          {{
            isMultiplayer && !amLastPainter
              ? '마지막 화가가 채점 결과를 보내면 함께 공개돼요'
              : '주제어를 알려주지 않고 무엇을 그렸는지 5개를 추측하게 해요'
          }}
        </p>
        <button v-if="showJudgeFallback" class="dr-quit" @click="retryJudge">
          결과가 오지 않아요 — 직접 채점하기
        </button>
      </template>
      <template v-else>
        <p class="dr-warn">{{ judgeError }}</p>
        <div class="dr-actions">
          <button class="dr-start" @click="retryJudge">🔁 다시 채점</button>
          <button class="dr-quit" @click="emit('close')">나가기</button>
        </div>
      </template>
    </div>

    <!-- 결과 -->
    <div v-if="phase === 'result' && judgeResult" class="dr-overlay">
      <p class="dr-tier">
        {{
          answerRank > 0
            ? `🎯 AI가 ${answerRank}순위로 "${topic}"을(를) 맞혔어요!`
            : judgeResult.guesses.length
              ? `💫 AI 추측 5개에 "${topic}"이(가) 없었어요`
              : '💫 채점 결과를 받지 못했어요'
        }}
      </p>
      <p class="dr-score">{{ finalScore }}<small>점</small></p>
      <div class="dr-result-body">
        <img class="dr-preview" :src="finalImage" alt="완성된 그림" />
        <ol class="dr-guesses">
          <li v-for="(g, i) in judgeResult.guesses" :key="i" :class="{ hit: i + 1 === answerRank }">
            <span class="dr-rank">{{ i + 1 }}위</span> {{ g }}
          </li>
        </ol>
      </div>
      <p v-if="judgeResult.source === 'mock'" class="dr-sub">
        모의 채점 결과예요 — VITE_GMS_KEY 설정 시 실제 AI가 채점해요
      </p>
      <div class="dr-actions">
        <!-- 다시 하기는 솔로 전용 — 멀티는 방장이 게임 선택으로 새 세션을 시작한다 -->
        <button v-if="!isMultiplayer" class="dr-start" @click="startGame">🔁 다시 하기</button>
        <button class="dr-quit" @click="emit('close')">
          {{ isMultiplayer ? '대기실로 돌아가기' : '나가기' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dr-shell {
  position: absolute;
  inset: 0;
  background: #efe9dc;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-family: var(--font-pixel);
  color: #2b2b33;
}
.dr-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: crosshair;
  touch-action: none;
}

.dr-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: linear-gradient(rgba(239, 233, 220, 0.95), rgba(239, 233, 220, 0));
  pointer-events: none;
}
.dr-topbar button {
  pointer-events: auto;
}
.dr-topic { font-size: 10px; color: #b0452b; white-space: nowrap; }
.dr-painter { font-size: 9px; color: #6b6455; white-space: nowrap; }
.dr-time-track { flex: 1; height: 8px; background: rgba(43, 43, 51, 0.12); border-radius: 6px; overflow: hidden; }
.dr-time-fill { height: 100%; background: linear-gradient(90deg, #7fbf6c, #ffd23f); transition: width 0.1s linear; }
.dr-timer { font-size: 11px; min-width: 44px; text-align: right; color: #b0452b; }
.dr-close {
  width: 26px; height: 26px; border: 2px solid rgba(43, 43, 51, 0.35); border-radius: 8px;
  background: rgba(239, 233, 220, 0.8); color: #2b2b33; font-size: 10px; cursor: pointer;
}

.dr-bottombar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  font-size: 8px;
  color: #8a8272;
  background: linear-gradient(rgba(239, 233, 220, 0), rgba(239, 233, 220, 0.95));
  pointer-events: none;
}
.dr-bottombar button {
  pointer-events: auto;
}
.dr-bottombar .on { color: #3f7d2f; }
.dr-hint { color: #b0452b; }
.dr-tools { margin-left: auto; display: flex; gap: 4px; }
.dr-tool {
  width: 28px; height: 28px; font-size: 12px; cursor: pointer;
  background: rgba(43, 43, 51, 0.08); border: 2px solid rgba(43, 43, 51, 0.2); border-radius: 8px;
}
.dr-tool.on { background: #ffd23f; border-color: #b0452b; }
.dr-pass {
  padding: 8px 14px; font-family: inherit; font-size: 9px; font-weight: 700; cursor: pointer;
  background: #2b2b33; color: #f6f1e5; border: none; border-radius: 10px;
}

.dr-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(43, 39, 30, 0.78);
  color: #f6f1e5;
  text-align: center;
  padding: 20px;
}
.dr-overlay-light { background: rgba(43, 39, 30, 0.55); }
.dr-guide { font-size: 10px; line-height: 2; margin: 0; }
.dr-guide b { color: #ffd23f; }
.dr-countdown { font-size: 56px; color: #ffd23f; margin: 0; }
.dr-players { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.dr-players button {
  padding: 8px 12px; font-family: inherit; font-size: 9px; cursor: pointer;
  background: rgba(255, 255, 255, 0.08); color: #d8d0be;
  border: 2px solid rgba(255, 255, 255, 0.18); border-radius: 10px;
}
.dr-players button.on { background: #ffd23f; color: #3a2c05; border-color: #ffd23f; }
.dr-warn { font-size: 8px; color: #ffd3b8; margin: 0; }
.dr-swap {
  display: flex; align-items: center; gap: 6px;
  font-size: 8px; color: #cfc6b2; cursor: pointer;
}
.dr-swap input { accent-color: #ffd23f; }
.dr-start {
  padding: 12px 20px; font-family: inherit; font-size: 10px; font-weight: 700; cursor: pointer;
  background: #e0642f; color: #fff4e8; border: none; border-radius: 12px;
}
.dr-quit {
  padding: 12px 20px; font-family: inherit; font-size: 10px; cursor: pointer;
  background: transparent; color: #f6f1e5; border: 2px solid rgba(255, 255, 255, 0.3); border-radius: 12px;
}
.dr-actions { display: flex; gap: 10px; }
.dr-tier { font-size: 12px; margin: 0; line-height: 1.8; }
.dr-score { font-size: 40px; color: #ffd23f; margin: 0; }
.dr-score small { font-size: 12px; margin-left: 4px; }
.dr-sub { font-size: 8px; color: #cfc6b2; margin: 0; }

.dr-result-body {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 90%;
}
.dr-preview {
  width: 220px;
  max-width: 40vw;
  border: 3px solid #f6f1e5;
  border-radius: 8px;
  background: #fdfdf8;
}
.dr-guesses {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}
.dr-guesses li {
  font-size: 9px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.07);
  border: 2px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
}
.dr-guesses li.hit { border-color: #ffd23f; background: rgba(255, 210, 63, 0.15); color: #ffd23f; }
.dr-rank { color: #ffd23f; margin-right: 6px; }
.dr-guesses li.hit .dr-rank { color: inherit; }
</style>
