<script setup lang="ts">
/**
 * 그림으로 말해요 — 그림 이어그리기 + AI 블라인드 채점.
 *
 * 총 1분 30초를 인원수로 나눠(올림) 한 명씩 같은 도화지에 이어 그리고, 완성 그림을
 * GMS 비전 모델에 주제어 없이 보내 "무엇을 그린 것인지" 5개 추측을 받는다.
 * 주제어가 추측 순위에 들면 순위별 점수(1순위 100 … 5순위 20).
 *
 * 조작(MediaPipe): 펜 손(기본 오른손)은 엄지+검지 핀치로 그리고 손을 펴면 이동,
 * 지우개 손(기본 왼손)은 주먹을 쥐고 문지르면 지운다 — 왼손잡이 모드로 역할 스왑.
 * 두 손은 각자 상태(스무딩·히스테리시스·진행 중 획)를 갖고 동시에 동작할 수 있다.
 * 펜 끝은 엄지·검지 중점을 써 손을 펴는 순간의 이동을 줄이고, 전환 프레임 동안
 * 그려지는 꼬리는 획을 점 목록으로 보관했다가 펜 업 시점에 소급 삭제한다(trimStrokeTail).
 * 입력은 손 인식뿐 — 카메라 영상이 있어야 시작할 수 있다(마우스 폴백은 로컬 테스트
 * 종료 후 제거).
 *
 * 멀티 전용(최소 3인, 명세 v0.2.20): 서버가 준 주제어·화가 순서·턴 스케줄을 전 클라이언트가
 * 서버 권위 시각으로 동일 계산한다(턴 전환 이벤트 없음). 내 차례에만 입력이 열리고, 획 연산을
 * 100ms 배치로 발신(draw emit → STOMP DRAW 릴레이)해 전원이 같은 도화지를 실시간으로 본다.
 * 마지막 화가가 GMS 채점 후 결과를 발신(drawResult emit) → DRAW_RESULT 에코를 전원이 받아
 * 같은 결과 화면으로 전환한다. 이어그리기라 솔로 플레이는 지원하지 않는다.
 *
 * 도화지는 <b>화가별 레이어</b>로 나뉜다 — 그리기는 자기 레이어에, 지우개는 자기 레이어에만
 * destination-out으로 작용해 <b>남이 그린 획은 지워지지 않는다</b>. 화면·채점 이미지는 레이어를
 * 화가 순서대로 겹쳐 합성해 만든다(뒤 순번이 위). 선 일부만 지우는 것도 자연스럽게 처리된다.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DrawOp, GameEvent, GameResultEntry } from '@/api/types'
import { useHandLandmarker, type HandLandmarkerResult } from '@/composables/useHandLandmarker'
import type { ActiveGameSession } from '../session'
import {
  MIN_PLAYERS,
  TOTAL_SECONDS,
  PEN_TIP_INDEX,
  applyPinchHysteresis,
  handRole,
  isFist,
  knuckleCenter,
  pinchMidpoint,
  pinchRatio,
  trimStrokeTail,
  type NormalizedPoint,
  type StrokePoint,
} from './logic'
import { requestJudge } from './scoring'

const props = defineProps<{
  /** 게임룸 셀프 타일의 <video> — 스트림이 attach되어 재생 중이어야 한다 */
  video: HTMLVideoElement | null
  /** 멀티플레이 세션(GAME_START) — turnOrder가 있어야 진행된다(솔로 미지원) */
  session?: ActiveGameSession | null
  /** 멀티 GAME_END — DRAW_RESULT 없이 타임아웃 정산됐을 때의 폴백 신호로만 쓴다 */
  results?: GameResultEntry[] | null
  myUserId?: string | null
  /** 멀티 DRAW/DRAW_RESULT 릴레이 피드(게임룸이 수신 순서대로 append) */
  drawEvents?: GameEvent[] | null
  /** userId → 닉네임 — 현재 화가 표시("xx님이 그리고 있어요!")용 */
  names?: Record<string, string> | null
  /** 서버 채점 요청에 쓰는 방 ID */
  roomId?: string | null
}>()
const emit = defineEmits<{
  close: []
  /** 멀티: 내 차례의 획 연산 배치(100ms 플러시) — 부모가 STOMP /game/draw로 발신 */
  draw: [seq: number, ops: DrawOp[]]
  /** 멀티: 조기 차례 넘기기 — 부모가 STOMP /game/turn-skip으로 발신, 에코로 전원 스케줄 당김 */
  turnSkip: [turnIndex: number, remainingMs: number]
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
const ERASER_WIDTH = 60
/** 주먹(지우개) 전환에 필요한 연속 프레임 수 — 순간 오인식으로 지워지는 것 방지 */
const FIST_CONFIRM_FRAMES = 3

const hand = useHandLandmarker()
const canvasRef = ref<HTMLCanvasElement>()
/** 부모(게임룸)가 게임 화면을 captureStream으로 송출할 수 있게 캔버스를 노출 */
defineExpose({ canvas: canvasRef })

// ── 도화지 — 화가별 레이어 ────────────────────
// 한 장에 전원이 그리면 지우개(도화지색 덧칠)가 남의 획까지 덮어버린다. 화가마다 투명
// 레이어를 주고 지우개를 destination-out으로 자기 레이어에만 적용하면 남의 획은 남는다.
// 화면·채점 이미지는 레이어를 화가 순서대로 겹쳐 만든다(뒤 순번이 위).
type Tool = 'pen' | 'erase'
interface Stroke {
  tool: Tool
  points: StrokePoint[]
}
/** strokes는 꼬리 삭제 후 레이어를 재생(rebuild)하기 위한 기록 — 지우개 획도 순서대로 담긴다. */
interface PainterLayer {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  strokes: Stroke[]
}
const layers = new Map<string, PainterLayer>()

/** 진행 중인 획의 소유자 — 펜 손·지우개 손·원격 화가가 각자 하나씩 갖는다(동시 사용 가능) */
interface StrokeSource {
  stroke: Stroke | null
}

function layerOf(painterId: string): PainterLayer {
  let layer = layers.get(painterId)
  if (!layer) {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    layer = { canvas, ctx: canvas.getContext('2d')!, strokes: [] }
    layers.set(painterId, layer)
  }
  return layer
}
/** 내 레이어 — 로컬 입력(펜 손·지우개 손)은 항상 여기로 간다 */
function myLayer(): PainterLayer {
  return layerOf(props.myUserId ?? 'me')
}

/** 합성 순서 = 화가 순서(뒤 순번이 위). 순서 목록 밖 레이어는 뒤에 붙인다(방어). */
function orderedLayers(): PainterLayer[] {
  const out: PainterLayer[] = []
  const seen = new Set<string>()
  for (const id of props.session?.turnOrder ?? []) {
    const layer = layers.get(id)
    if (layer) {
      out.push(layer)
      seen.add(id)
    }
  }
  for (const [id, layer] of layers) if (!seen.has(id)) out.push(layer)
  return out
}

/** 도화지 배경 + 레이어 합성 — 화면 렌더와 채점 이미지가 같은 경로를 쓴다 */
function composite(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = PAPER_COLOR
  ctx.fillRect(0, 0, W, H)
  for (const layer of orderedLayers()) ctx.drawImage(layer.canvas, 0, 0)
}

/** 채점용 완성 그림(PNG data URL) */
function snapshot(): string {
  const flat = document.createElement('canvas')
  flat.width = W
  flat.height = H
  composite(flat.getContext('2d')!)
  return flat.toDataURL('image/png')
}

function resetPaper() {
  layers.clear()
  penHand.stroke = null
  eraseHand.stroke = null
}

// ── 게임 상태 (명세 v0.2.20 — 서버 스케줄 계산·획 릴레이) ──
const phase = ref<'waiting' | 'handover' | 'drawing' | 'judging' | 'result'>('waiting')
const topic = ref('')
const turnIndex = ref(0)
const timeLeft = ref(0)
const handoverLeft = ref(HANDOVER_SECONDS)

/** 서버가 화가 순서를 내려줘야 진행된다 — 솔로 플레이는 지원하지 않는다(이어그리기 게임) */
const sessionReady = computed(() => !!props.session?.turnOrder?.length)
const playerCount = computed(() => props.session?.turnOrder?.length ?? 0)
/** 인당 그리기 시간·교대 시간의 권위는 서버(GAME_START) */
const turnSeconds = computed(() => props.session?.turnDurationSec ?? 0)
const mpHandoverSec = computed(() => props.session?.handoverSec ?? HANDOVER_SECONDS)
/** 지금(또는 다가오는) 차례가 내 차례인지 */
const myTurn = computed(
  () => sessionReady.value && props.session!.turnOrder![turnIndex.value] === props.myUserId,
)
const amLastPainter = computed(() => {
  const order = props.session?.turnOrder
  return !!order?.length && order[order.length - 1] === props.myUserId
})
/** 현재(또는 다가오는) 화가의 닉네임 — 모르면 null(순번으로 폴백 표시) */
const painterName = computed(() => {
  const id = props.session?.turnOrder?.[turnIndex.value]
  return (id && props.names?.[id]) || null
})
/** 채점 대기 경과(초) — 관전자 폴백 채점 버튼 노출 판단 */
const resultWaitSec = ref(0)
/** 조기 차례 넘기기 요청 후 에코 대기 — 연타로 다음 화가 시간까지 깎는 것 방지 */
const skipRequested = ref(false)
const showJudgeFallback = computed(
  () => sessionReady.value && !amLastPainter.value && resultWaitSec.value >= 20,
)

/** 서버 권위 시각 — 턴 스케줄 계산의 기준 */
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
/** 새 비디오 프레임이 한 번이라도 들어왔는지 — 아니면 "마우스로 그리기" 안내 */
const gotFrame = ref(false)

/** 서버가 배포한 채점 결과(DRAW_RESULT). 도착 전에는 null — 채점 대기 화면 */
const judgeResult = ref<{ guesses: string[] } | null>(null)
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

// ── 멀티 획 릴레이 상태 ──
/** 내 차례에 쌓는 발신 대기 획 연산 — 100ms 간격으로 draw emit */
let outbox: DrawOp[] = []
let drawSeq = 0
/** drawEvents 피드에서 처리한 위치 */
let lastAppliedDrawIndex = 0
let mpJudgingStarted = false
/** 조기 차례 넘기기 누적(ms) — TURN_SKIPPED 에코마다 더해 전원이 같은 스케줄을 당긴다 */
let skippedMs = 0
/** 같은 턴의 중복 TURN_SKIPPED(연타·중복 프레임) 이중 적용 방지 */
let lastSkippedTurn = -1
/** 원격 화가별 진행 중/직전 획 — trim(꼬리 삭제) 적용 대상 추적 */
interface RemoteSource extends StrokeSource {
  lastEnded: Stroke | null
}
const remoteStrokes = new Map<string, RemoteSource>()

/** 내 차례에만 획 연산을 발신 큐에 쌓는다 */
function pushOp(op: DrawOp) {
  if (myTurn.value) outbox.push(op)
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

// ── 타이머(인터벌) + 렌더(RAF) 루프 — 카메라 프레임과 독립.
// 단계 전환을 RAF에 태우면 탭이 가려질 때 RAF가 멈춰 게임이 정지하므로,
// 전환은 인터벌로 구동하고 RAF는 화면 갱신만 맡는다(핑거 스타 멀티 타이머와 같은 구조).
let rafId = 0
let phaseTicker = 0
onMounted(() => {
  phaseTicker = window.setInterval(() => {
    mpTick()
    flushOutbox()
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
      phase.value = 'waiting'
      return
    }
    topic.value = session.topicWord ?? '???'
    resetPaper()
    remoteStrokes.clear()
    outbox = []
    drawSeq = 0
    lastAppliedDrawIndex = 0
    mpJudgingStarted = false
    skippedMs = 0
    lastSkippedTurn = -1
    skipRequested.value = false
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
  // 조기 차례 넘기기 누적만큼 스케줄이 앞당겨진다(전원 동일 — TURN_SKIPPED 에코 기준)
  const elapsed = now - s.startAt + skippedMs
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
    skipRequested.value = false
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

/** 모든 턴 종료 → 채점 단계. 마지막 화가가 서버에 채점을 요청하고 결과는 전원이 에코로 받는다. */
function beginMpJudging() {
  if (mpJudgingStarted) return
  mpJudgingStarted = true
  endAllStrokes()
  flushOutbox()
  phase.value = 'judging'
  finalImage.value = snapshot()
  if (amLastPainter.value) void judgeMp()
}

/**
 * 도화지를 서버에 올려 채점을 맡긴다 — AI 호출도 점수 계산도 서버가 한다(키가 프론트에 없다).
 * 결과 화면 전환은 DRAW_RESULT 에코 수신 시 — 전원이 같은 경로로 같은 결과를 본다.
 */
async function judgeMp() {
  if (!props.roomId) {
    judgeError.value = '방 정보를 찾지 못해 채점을 요청할 수 없어요'
    return
  }
  judgeError.value = null
  try {
    await requestJudge(props.roomId, finalImage.value)
  } catch (e) {
    judgeError.value = e instanceof Error ? e.message : 'AI 채점에 실패했어요'
  }
}

/** 차례 마치기 — 남은 시간을 서버로 보내 전원 스케줄을 당긴다(마지막 화가면 곧장 채점) */
function passTurn() {
  const s = props.session
  if (!s?.turnOrder?.length || !myTurn.value || phase.value !== 'drawing' || skipRequested.value) return
  const h = mpHandoverSec.value * 1000
  const slot = h + turnSeconds.value * 1000
  const elapsed = serverNow() - s.startAt + skippedMs
  const remaining = Math.max(0, Math.round(slot - (elapsed - turnIndex.value * slot)))
  skipRequested.value = true
  endAllStrokes()
  flushOutbox()
  // 스케줄 적용은 TURN_SKIPPED 에코 수신 시 — 전원이 같은 값으로 당긴다
  emit('turnSkip', turnIndex.value, remaining)
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
      } else if (e.type === 'TURN_SKIPPED') {
        // 같은 턴 중복 이벤트는 한 번만 — 슬롯 길이 클램프로 과도한 당김 방어
        if (e.turnIndex > lastSkippedTurn) {
          lastSkippedTurn = e.turnIndex
          const slot = (mpHandoverSec.value + turnSeconds.value) * 1000
          skippedMs += Math.max(0, Math.min(e.remainingMs, slot))
          beep(660)
        }
      } else if (e.type === 'DRAW_RESULT') {
        applyDrawResult(e.guesses, e.answerRank, e.score)
      }
    }
  },
)

/** 원격 화가의 획 연산 적용 — 그 화가의 레이어에 그린다(지우개도 그 레이어에만 작용) */
function applyRemoteOps(userId: string, ops: DrawOp[]) {
  let src = remoteStrokes.get(userId)
  if (!src) {
    src = { stroke: null, lastEnded: null }
    remoteStrokes.set(userId, src)
  }
  const layer = layerOf(userId)
  for (const op of ops) {
    if (op.type === 'begin') {
      const tool: Tool = op.tool === 'erase' ? 'erase' : 'pen'
      const x = op.x ?? 0
      const y = op.y ?? 0
      src.stroke = { tool, points: [{ x, y, t: performance.now() }] }
      layer.strokes.push(src.stroke)
      drawDot(layer.ctx, x, y, tool)
    } else if (op.type === 'point') {
      const s = src.stroke
      if (!s) continue
      const prev = s.points[s.points.length - 1]!
      const x = op.x ?? prev.x
      const y = op.y ?? prev.y
      s.points.push({ x, y, t: performance.now() })
      drawSegment(layer.ctx, prev, { x, y }, s.tool)
    } else if (op.type === 'end') {
      if (src.stroke) src.lastEnded = src.stroke
      src.stroke = null
    } else if (op.type === 'trim') {
      // 화가의 펜 업 꼬리 삭제 동기화 — 직전 획을 x개 점으로 절단하고 레이어를 다시 그린다
      const target = src.stroke ?? src.lastEnded
      const keep = Math.max(1, Math.floor(op.x ?? 1))
      if (target && target.points.length > keep) {
        target.points = target.points.slice(0, keep)
        rebuildLayer(layer)
      }
    }
  }
}

/** DRAW_RESULT 수신 — 전원 동일 결과 화면 */
function applyDrawResult(guesses: string[], rank: number, score: number) {
  judgeResult.value = { guesses }
  answerRank.value = rank
  finalScore.value = score
  if (!finalImage.value) finalImage.value = snapshot()
  phase.value = 'result'
  beep(880)
}

// DRAW_RESULT 없이 서버 타임아웃 정산(GAME_END)만 온 경우 — 미채점 0점으로 마감
watch(
  () => props.results,
  (results) => {
    if (!results || !sessionReady.value || judgeResult.value) return
    judgeResult.value = { guesses: [] }
    answerRank.value = 0
    finalScore.value = 0
    if (!finalImage.value) finalImage.value = snapshot()
    phase.value = 'result'
  },
)

// ── 그리기 (화가 레이어에 획 누적) ─────────────
function strokeWidth(tool: Tool): number {
  return tool === 'erase' ? ERASER_WIDTH : PEN_WIDTH
}
/**
 * 지우개는 destination-out — 색을 칠하는 게 아니라 <b>이 레이어의 잉크만</b> 알파에서 깎아낸다.
 * 그래서 아래에 깔린 다른 화가의 레이어는 그대로 남는다.
 */
function applyTool(ctx: CanvasRenderingContext2D, tool: Tool) {
  ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over'
  ctx.fillStyle = PEN_COLOR
  ctx.strokeStyle = PEN_COLOR
  ctx.lineWidth = strokeWidth(tool)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}
function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, tool: Tool) {
  applyTool(ctx, tool)
  ctx.beginPath()
  ctx.arc(x, y, strokeWidth(tool) / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
}
function drawSegment(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  tool: Tool,
) {
  applyTool(ctx, tool)
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  ctx.globalCompositeOperation = 'source-over'
}

function drawTo(layer: PainterLayer, src: StrokeSource, x: number, y: number, tool: Tool) {
  if (src.stroke && src.stroke.tool !== tool) endStroke(layer, src)
  const t = performance.now()
  if (!src.stroke) {
    src.stroke = { tool, points: [{ x, y, t }] }
    layer.strokes.push(src.stroke)
    drawDot(layer.ctx, x, y, tool)
    pushOp({ type: 'begin', tool, x, y })
    return
  }
  const prev = src.stroke.points[src.stroke.points.length - 1]!
  src.stroke.points.push({ x, y, t })
  drawSegment(layer.ctx, prev, { x, y }, tool)
  pushOp({ type: 'point', x, y })
}

/** 소스의 획 종료. trimTail이면(손 제스처 펜 업) 놓는 동안 그려진 꼬리 점을 소급 삭제한다. */
function endStroke(layer: PainterLayer, src: StrokeSource, trimTail = false) {
  const s = src.stroke
  if (!s) return
  pushOp({ type: 'end' })
  if (trimTail && s.tool === 'pen') {
    const trimmed = trimStrokeTail(s.points, performance.now())
    if (trimmed.length !== s.points.length) {
      s.points = trimmed
      rebuildLayer(layer)
      // 관전자도 같은 꼬리 삭제를 하도록 남길 점 수를 알린다(직전 획 대상)
      pushOp({ type: 'trim', x: trimmed.length })
    }
  }
  src.stroke = null
}

/** 내 입력 소스의 획 종료 — 차례 전환·게임 종료 시(타이머가 끊은 획은 꼬리 삭제 없음) */
function endAllStrokes() {
  const layer = myLayer()
  endStroke(layer, penHand)
  endStroke(layer, eraseHand)
}

/** 한 화가의 레이어를 기록대로 다시 그린다 — 꼬리 삭제 직후에만 호출(매 프레임 아님) */
function rebuildLayer(layer: PainterLayer) {
  layer.ctx.clearRect(0, 0, W, H)
  for (const s of layer.strokes) {
    const first = s.points[0]
    if (!first) continue
    drawDot(layer.ctx, first.x, first.y, s.tool)
    for (let i = 1; i < s.points.length; i++) {
      drawSegment(layer.ctx, s.points[i - 1]!, s.points[i]!, s.tool)
    }
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

/** 지금 그릴 권한 — 내 차례에만 입력이 열린다(관전자는 커서·상태만 표시) */
function inputAllowed(): boolean {
  return myTurn.value
}

/** 손이 화면에서 사라졌을 때의 상태 정리 */
function resetHand(h: HandState, trimTail: boolean) {
  endStroke(myLayer(), h, trimTail)
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
  const canAct = phase.value === 'drawing' && inputAllowed()
  if (down && canAct) {
    drawTo(myLayer(), penHand, penHand.x, penHand.y, 'pen')
  } else {
    // 펜을 놓는 순간 — 손을 펴는 동안 그려진 꼬리를 소급 삭제
    endStroke(myLayer(), penHand, true)
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

  const canAct = phase.value === 'drawing' && inputAllowed()
  if (eraseHand.fist && canAct) drawTo(myLayer(), eraseHand, eraseHand.x, eraseHand.y, 'erase')
  else endStroke(myLayer(), eraseHand)
  eraseHand.active = eraseHand.fist
  erasing.value = eraseHand.fist && canAct
}

// ── 렌더링 (도화지 + 펜/지우개 커서) ──────────
function render() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  composite(ctx)

  if (phase.value !== 'drawing') return
  // 지우개 손 커서 — 주먹이면 활성 표시, 아니면 위치 예고
  if (eraseDetected.value) drawEraserCursor(ctx, eraseHand.x, eraseHand.y, erasing.value)
  // 펜 손 커서
  if (penDetected.value) drawPenCursor(ctx, penHand.x, penHand.y, penDrawing.value)
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

</script>

<template>
  <div class="dr-shell">
    <canvas ref="canvasRef" class="dr-canvas" :width="W" :height="H" />

    <!-- 상단 바: 주제어 · 화가 순번 · 턴 타이머 -->
    <div class="dr-topbar">
      <span class="dr-topic">🎨 주제어: {{ sessionReady ? topic : '???' }}</span>
      <span v-if="sessionReady" class="dr-painter">
        화가 {{ turnIndex + 1 }} / {{ playerCount
        }}{{
          myTurn
            ? ' · 내 차례!'
            : ` · ${painterName ? `${painterName}님이` : '다른 화가가'} 그리고 있어요!`
        }}
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
        ✏️ 펜·{{ penHandLabel }} 엄지검지 {{ penDetected ? (penDrawing ? '그리는 중' : '이동') : '—' }}
      </span>
      <span :class="{ on: erasing }">
        🧽 지우개·{{ eraseHandLabel }} 주먹 {{ eraseDetected ? (erasing ? '지우는 중' : '대기') : '—' }}
      </span>
      <span v-if="!gotFrame" class="dr-hint">카메라 영상을 기다리는 중…</span>
      <!-- 손 역할 스왑 — 개인 설정이라 언제든 바꿀 수 있게 상태 옆에 둔다 -->
      <button class="dr-swap-btn" :title="`현재 ${penHandLabel} 펜 · ${eraseHandLabel} 지우개`" @click="swapHands = !swapHands">
        ✋ 손 바꾸기
      </button>
      <!-- 차례 넘기기 — 관전자에게는 숨김. TURN_SKIPPED 릴레이로 전원 스케줄을 당긴다
           (마지막 화가면 곧장 채점으로) -->
      <button
        v-if="phase === 'drawing' && myTurn"
        class="dr-pass"
        :disabled="skipRequested"
        @click="passTurn"
      >
        {{ turnIndex + 1 < playerCount ? '차례 마치기 ▶' : '완성! 채점하기 ▶' }}
      </button>
    </div>

    <!-- 세션 대기 — 이어그리기라 솔로가 없다. 서버 GAME_START(화가 순서)를 받아야 진행된다 -->
    <div v-if="phase === 'waiting'" class="dr-overlay">
      <p class="dr-guide">
        총 {{ Math.floor(TOTAL_SECONDS / 60) }}분 {{ TOTAL_SECONDS % 60 }}초를 인원수로 나눠 한
        도화지에 그림을 이어 그려요.<br />
        <b>{{ penHandLabel }}</b> 엄지+검지를 <b>집으면</b> 그리기 · 펴면 이동,
        <b>{{ eraseHandLabel }} 주먹</b>으로 문지르면 지우개!<br />
        완성 그림을 본 AI의 추측 5개 안에 주제어가 있으면 점수!
      </p>
      <p class="dr-sub">
        {{ MIN_PLAYERS }}명 이상 모이면 방장이 시작할 수 있어요 — 혼자서는 진행할 수 없는
        이어그리기 게임이에요
      </p>
      <p v-if="hand.error.value" class="dr-warn">{{ hand.error.value }}</p>
      <p v-else-if="hand.isLoading.value" class="dr-warn">손 인식 모델 로딩 중…</p>
      <p v-else-if="!gotFrame" class="dr-warn">카메라 영상을 기다리는 중… (카메라가 켜져 있어야 해요)</p>
      <button class="dr-quit" @click="emit('close')">나가기</button>
    </div>

    <!-- 차례 교대 -->
    <div v-if="phase === 'handover'" class="dr-overlay dr-overlay-light">
      <p class="dr-guide">
        <b>{{ painterName ? `${painterName}님` : `${turnIndex + 1}번째 화가` }}</b>
        차례!<br />주제어: <b>{{ topic }}</b>
      </p>
      <p class="dr-countdown">{{ handoverLeft }}</p>
      <p class="dr-sub">
        {{
          myTurn
            ? '내 차례예요 — 이어서 그려주세요!'
            : `${painterName ? `${painterName}님이` : '다른 화가가'} 이어 그려요 — 같은 도화지가 실시간으로 보여요`
        }}
      </p>
    </div>

    <!-- AI 채점 중 -->
    <div v-if="phase === 'judging'" class="dr-overlay">
      <template v-if="!judgeError">
        <p class="dr-guide">🤖 AI가 그림을 살펴보는 중…</p>
        <p class="dr-sub">
          {{
            amLastPainter
              ? '주제어를 알려주지 않고 무엇을 그렸는지 5개를 추측하게 해요'
              : '마지막 화가가 채점 결과를 보내면 함께 공개돼요'
          }}
        </p>
        <button v-if="showJudgeFallback" class="dr-quit" @click="judgeMp">
          결과가 오지 않아요 — 직접 채점하기
        </button>
      </template>
      <template v-else>
        <p class="dr-warn">{{ judgeError }}</p>
        <div class="dr-actions">
          <button class="dr-start" @click="judgeMp">🔁 다시 채점</button>
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
      <!-- 새 판은 방장이 게임 선택으로 다시 시작한다 -->
      <div class="dr-actions">
        <button class="dr-quit" @click="emit('close')">대기실로 돌아가기</button>
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
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 상단바 — 주제어는 게임 내내 필요한 핵심 정보라 오버레이 위(z-index)에 항상 보이게 둔다.
   칩을 타일 좌상단 모서리에 딱 붙여 게임룸의 YOU·HOST 라벨(top 8/left 8)을 덮는다 — 게임 중엔
   그 라벨보다 주제어가 우선이고, 겹쳐 보이는 것보다 깔끔하다. */
.dr-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 10px 0 0;
  background: linear-gradient(rgba(239, 233, 220, 0.96), rgba(239, 233, 220, 0));
  pointer-events: none;
}
.dr-topbar button {
  pointer-events: auto;
}
.dr-topic {
  font-size: 26px; font-weight: 700; white-space: nowrap;
  padding: 10px 18px 8px 14px; border-radius: 0 0 14px 0;
  background: #ffd23f; color: #3a2c05;
  border: 3px solid #2b2b33; border-top: none; border-left: none;
  box-shadow: 3px 3px 0 rgba(43, 43, 51, 0.25);
}
/* 멀티에서 "OO님이 그리고 있어요!"가 길어질 수 있어 좁은 화면에서는 말줄임으로 우아하게 줄인다 */
.dr-painter {
  font-size: 18px; color: #5c5546; white-space: nowrap;
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
.dr-time-track { flex: 1; min-width: 60px; height: 14px; background: rgba(43, 43, 51, 0.15); border-radius: 8px; overflow: hidden; }
.dr-time-fill { height: 100%; background: linear-gradient(90deg, #7fbf6c, #ffd23f); transition: width 0.1s linear; }
.dr-timer { font-size: 26px; font-weight: 700; min-width: 88px; text-align: right; color: #b0452b; }
.dr-close {
  width: 44px; height: 44px; border: 0; border-radius: 0;
  background: transparent; color: #2b2b33; font-size: 24px; font-weight: 700 !important;
  box-shadow: none; cursor: pointer;
}

/* 하단바 — 상태는 좌하단, 차례 버튼은 우하단 모서리에 붙인다 */
.dr-bottombar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: flex-end;
  gap: 14px;
  padding: 8px 10px;
  font-size: 14px;
  color: #6d6555;
  background: linear-gradient(rgba(239, 233, 220, 0), rgba(239, 233, 220, 0.96));
  pointer-events: none;
}
.dr-bottombar button {
  pointer-events: auto;
}
.dr-bottombar .on { color: #3f7d2f; font-weight: 700; }
.dr-hint { color: #b0452b; }
.dr-swap-btn {
  padding: 8px 12px; font-family: inherit; font-size: 13px; cursor: pointer;
  background: rgba(43, 43, 51, 0.08); color: #4a4438;
  border: 2px solid rgba(43, 43, 51, 0.25); border-radius: 10px;
}
.dr-pass {
  margin-left: auto;
  padding: 12px 18px; font-family: inherit; font-size: 15px; font-weight: 700; cursor: pointer;
  background: #2b2b33; color: #f6f1e5; border: none; border-radius: 12px;
}
.dr-pass:disabled { opacity: 0.5; cursor: default; }

/* 오버레이 — 상단바(z-index 2) 아래에 깔린다. 큰 폰트가 넘칠 수 있어 상단 여백 + 스크롤 허용 */
.dr-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(43, 39, 30, 0.78);
  color: #f6f1e5;
  text-align: center;
  padding: 60px 24px 16px;
  overflow-y: auto;
}
.dr-overlay-light { background: rgba(43, 39, 30, 0.55); }
.dr-guide { font-size: 21px; line-height: 1.8; margin: 0; }
.dr-guide b { color: #ffd23f; }
.dr-countdown { font-size: 88px; color: #ffd23f; margin: 0; line-height: 1; }
.dr-warn { font-size: 15px; color: #ffd3b8; margin: 0; }
.dr-start {
  padding: 13px 22px; font-family: inherit; font-size: 16px; font-weight: 700; cursor: pointer;
  background: #e0642f; color: #fff4e8; border: none; border-radius: 14px;
}
.dr-start:disabled { opacity: 0.45; cursor: not-allowed; }
.dr-quit {
  padding: 13px 22px; font-family: inherit; font-size: 16px; cursor: pointer;
  background: transparent; color: #f6f1e5; border: 2px solid rgba(255, 255, 255, 0.3); border-radius: 14px;
}
.dr-actions { display: flex; gap: 12px; }
.dr-tier { font-size: 18px; margin: 0; line-height: 1.5; }
.dr-score { font-size: 48px; color: #ffd23f; margin: 0; line-height: 1.1; }
.dr-score small { font-size: 16px; margin-left: 6px; }
.dr-sub { font-size: 15px; color: #cfc6b2; margin: 0; }

/* 결과 — 큰 폰트에서도 안 넘치게 줄바꿈 허용 */
.dr-result-body {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 20px;
  max-width: 92%;
}
.dr-preview {
  width: 220px;
  max-width: 40vw;
  border: 3px solid #f6f1e5;
  border-radius: 10px;
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
  font-size: 15px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.07);
  border: 2px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
}
.dr-guesses li.hit { border-color: #ffd23f; background: rgba(255, 210, 63, 0.15); color: #ffd23f; }
.dr-rank { color: #ffd23f; margin-right: 8px; }
.dr-guesses li.hit .dr-rank { color: inherit; }
</style>
