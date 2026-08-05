<script setup lang="ts">
import { useScrollLockWhen } from '@/composables/useScrollLock'
/**
 * AI 아이템 생성 (API §3 /shop/ai-items, -102) — "생성 → 확인 → 저장" 흐름.
 * GPU 워커가 폴링해 비동기로 처리하므로, POST는 jobId만 즉시 돌려주고
 * DONE/FAILED가 될 때까지 GET /shop/ai-items/{jobId}를 주기적으로 확인해야 한다.
 * 생성만으로는 인벤토리에 들어가지 않는다 — 결과를 모달로 보여주고, 유저가
 * "저장하기"를 눌러 POST /shop/ai-items/{jobId}/save를 호출해야 지급된다.
 */
import { computed, onUnmounted, onMounted, ref } from 'vue'
import { shopApi, usersApi, ApiError, type AiItemJobStatus, type ItemCategory } from '@/api'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import { useToast } from '@/composables/useToast'
import { useSessionStore } from '@/stores/session'
import aiDrawingCat from '@/assets/ai/ai-drawing-cat.png'

const POLL_INTERVAL_MS = 1500
const POLL_MAX_ATTEMPTS = 40 // 1.5s * 40 = 60초
const POLL_MAX_CONSECUTIVE_FAILURES = 3
/** 총 시도 횟수 = 최초 생성 1회 + 재시도 1회. 재시도는 첫 결과에서만 노출한다. */
const MAX_ATTEMPTS = 2
/** AI 아이템 생성 1회 결제 비용(포인트). 서버 app.shop.ai-item-cost와 같은 값이어야 한다. */
const AI_ITEM_COST = 1500

const { message: toast, flash } = useToast()
const session = useSessionStore()

const canvas = ref<HTMLCanvasElement>()
const name = ref('')
const category = ref<ItemCategory>('STICKER')
// 모달 상태 — generating(생성 중, 닫기 불가) / done(결과 확인) / failed(실패, 닫기 가능)
const modalOpen = ref(false)
const phase = ref<'generating' | 'done' | 'failed'>('generating')
const jobStatus = ref<AiItemJobStatus | ''>('')
const resultImageUrl = ref<string | null>(null)
const showPointConfirm = ref(false)
type GeneratedResult = { jobId: number; imageUrl: string }
const generatedResults = ref<GeneratedResult[]>([])
const selectedResultJobId = ref<number | null>(null)
const showClearConfirm = ref(false)
/** "다시 생성하기"로 모달을 닫은 직후 true — 이미 결제한 세션의 2회차이므로 다음 생성 클릭 때
 * 포인트 확인 모달을 건너뛴다. */
const pendingRetry = ref(false)
type DrawingTool = 'pen' | 'eraser' | 'fill'
const drawingTool = ref<DrawingTool>('pen')
const brushSize = ref(4)
const brushColor = ref('#38263d')
const palette = ['#38263d', '#ef6872', '#f2b94b', '#48c8a4', '#6579dd', '#9a72d8']

const strokes: { x: number; y: number }[][] = []
let current: { x: number; y: number }[] | null = null
const failMessage = ref('')
const currentJobId = ref<number | null>(null)
/** 이번 결제 세션에서 최초로 생성된(포인트를 차감한) job의 id. currentJobId는 재생성 때마다
 * 새 job으로 갱신되어 버리므로, 재생성 요청의 parentJobId로 쓸 값은 따로 보관해야 한다.
 * 새 결제 세션 시작(generate) 때만 초기화하고, 재생성 중에는 절대 덮어쓰지 않는다. */
const paidJobId = ref<number | null>(null)
const attemptCount = ref(0)
const saving = ref(false)

let ctx: CanvasRenderingContext2D | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null
const HISTORY_LIMIT = 30
let history: ImageData[] = []
const historyIndex = ref(-1)
const historyLength = ref(0)
const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(() => historyIndex.value < historyLength.value - 1)

onMounted(() => {
  const el = canvas.value!
  /*
   * willReadFrequently — 이 캔버스는 그림을 읽는 쪽이 더 잦다: 획마다 되돌리기 스냅샷을 뜨고
   * (saveHistory), 채우기 도구와 "빈 그림인지" 검사도 매번 전체 픽셀을 읽는다(getImageData 3곳).
   * 이 힌트가 없으면 브라우저가 GPU 뒤에 캔버스를 두는데, 읽을 때마다 GPU→CPU로 되가져와야 해서
   * 느려지고 콘솔에도 경고가 남는다. 대신 그리기는 소프트웨어로 도는데, 360x300에 단순 선이라
   * 체감 차이가 없다.
   */
  ctx = el.getContext('2d', { willReadFrequently: true })
  applyDrawingTool()
  saveHistory()
})

onUnmounted(() => {
  clearPollTimer()
})

function clearPollTimer() {
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function pos(e: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  const el = canvas.value!
  return {
    x: (e.clientX - rect.left) * (el.width / rect.width),
    y: (e.clientY - rect.top) * (el.height / rect.height),
  }
}
function applyDrawingTool() {
  if (!ctx) return
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalCompositeOperation = drawingTool.value === 'eraser' ? 'destination-out' : 'source-over'
  ctx.lineWidth = brushSize.value
  ctx.strokeStyle = brushColor.value
}
function selectTool(tool: DrawingTool) {
  drawingTool.value = tool
  applyDrawingTool()
}
function selectColor(color: string) {
  brushColor.value = color
  applyDrawingTool()
}
function saveHistory() {
  const el = canvas.value
  if (!el || !ctx) return
  history = history.slice(0, historyIndex.value + 1)
  history.push(ctx.getImageData(0, 0, el.width, el.height))
  if (history.length > HISTORY_LIMIT) history.shift()
  historyIndex.value = history.length - 1
  historyLength.value = history.length
}
function restoreHistory(index: number) {
  const snapshot = history[index]
  if (!snapshot || !ctx) return
  ctx.putImageData(snapshot, 0, 0)
  historyIndex.value = index
}
function undo() {
  if (canUndo.value) restoreHistory(historyIndex.value - 1)
}
function redo() {
  if (canRedo.value) restoreHistory(historyIndex.value + 1)
}
function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}
function fillAt(x: number, y: number) {
  const el = canvas.value
  if (!el || !ctx) return
  const image = ctx.getImageData(0, 0, el.width, el.height)
  const startX = Math.max(0, Math.min(el.width - 1, Math.floor(x)))
  const startY = Math.max(0, Math.min(el.height - 1, Math.floor(y)))
  const start = (startY * el.width + startX) * 4
  const target = [image.data[start]!, image.data[start + 1]!, image.data[start + 2]!, image.data[start + 3]!]
  const next = hexToRgb(brushColor.value)
  if (target[0] === next.r && target[1] === next.g && target[2] === next.b && target[3] === 255) return
  const stack: [number, number][] = [[startX, startY]]
  while (stack.length) {
    const [px, py] = stack.pop()!
    if (px < 0 || py < 0 || px >= el.width || py >= el.height) continue
    const index = (py * el.width + px) * 4
    if (image.data[index] !== target[0] || image.data[index + 1] !== target[1] || image.data[index + 2] !== target[2] || image.data[index + 3] !== target[3]) continue
    image.data[index] = next.r
    image.data[index + 1] = next.g
    image.data[index + 2] = next.b
    image.data[index + 3] = 255
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1])
  }
  ctx.putImageData(image, 0, 0)
}
function down(e: PointerEvent) {
  canvas.value?.setPointerCapture(e.pointerId)
  const p = pos(e)
  if (drawingTool.value === 'fill') {
    strokes.push([p])
    fillAt(p.x, p.y)
    saveHistory()
    return
  }
  current = []
  strokes.push(current)
  applyDrawingTool()
  current.push(p)
  ctx?.beginPath()
  ctx?.moveTo(p.x, p.y)
}
function move(e: PointerEvent) {
  if (!current) return
  const p = pos(e)
  current.push(p)
  ctx?.lineTo(p.x, p.y)
  ctx?.stroke()
}
function up() {
  if (current) saveHistory()
  current = null
}
function requestClear() {
  if (historyIndex.value <= 0) return
  showClearConfirm.value = true
}
function clear() {
  const el = canvas.value!
  ctx?.clearRect(0, 0, el.width, el.height)
  history = []
  historyIndex.value = -1
  historyLength.value = 0
  saveHistory()
  showClearConfirm.value = false
}

/**
 * 캔버스에 실제로 그려진 픽셀이 있는지 검사한다. 예전엔 strokes 배열 길이로 판단했는데,
 * 지우개로 전부 지워도 배열엔 좌표가 남아 있어 빈 캔버스인데 생성 요청이 나가는 문제가 있었다.
 * 알파값이 0이 아닌 픽셀이 하나라도 있으면 그림이 있는 것으로 본다.
 */
function hasDrawing(): boolean {
  const el = canvas.value
  if (!el || !ctx) return false
  const { data } = ctx.getImageData(0, 0, el.width, el.height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return true
  }
  return false
}

const generatingLabel = computed(() => (jobStatus.value === 'PENDING' ? '대기 중…' : '그리는 중…'))
const canRetry = computed(() => attemptCount.value < MAX_ATTEMPTS)
const selectedResult = computed(() => generatedResults.value.find(({ jobId }) => jobId === selectedResultJobId.value) ?? null)

/** AI 모델이 이 해상도로 학습돼 있어, 저해상도 원본을 그대로 보내면 인식률이 떨어진다. */
const SKETCH_TARGET_SIZE = 1024

/**
 * 캔버스를 1024x1024 base64 PNG로 변환한다. 투명 배경은 AI 인식률이 크게 떨어지므로
 * 흰 배경을 먼저 채운 임시 캔버스에 그리고, 원본(360x300)은 비율을 유지한 채 중앙에
 * 확대해서 그린다 — imageSmoothingEnabled를 꺼서 확대 시 선이 뭉개지지 않게 한다.
 * 백엔드는 순수 base64만 받으므로 "data:image/png;base64," 접두사는 잘라낸다.
 */
function canvasToSketchBase64(): string {
  const src = canvas.value!
  const off = document.createElement('canvas')
  off.width = SKETCH_TARGET_SIZE
  off.height = SKETCH_TARGET_SIZE
  const octx = off.getContext('2d')!
  octx.fillStyle = '#ffffff'
  octx.fillRect(0, 0, off.width, off.height)

  const scale = Math.min(SKETCH_TARGET_SIZE / src.width, SKETCH_TARGET_SIZE / src.height)
  const drawWidth = src.width * scale
  const drawHeight = src.height * scale
  const offsetX = (SKETCH_TARGET_SIZE - drawWidth) / 2
  const offsetY = (SKETCH_TARGET_SIZE - drawHeight) / 2

  octx.imageSmoothingEnabled = false
  octx.drawImage(src, offsetX, offsetY, drawWidth, drawHeight)

  return off.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

/**
 * "AI로 생성하기" — 검증 후 진행한다. attemptCount는 "다시 생성하기"로 모달을 닫은 뒤
 * 다시 눌렀을 때도 이어서 올라간다(재시도 후 2회차가 되도록) — 페이지를 벗어나기 전까진
 * 초기화하지 않는다.
 *
 * pendingRetry가 서 있으면(방금 "다시 생성하기"로 모달을 닫은 직후) 이미 결제를 마친
 * 세션의 2회차이므로 포인트 확인 모달 없이 바로 재생성한다. 그 외엔 새 세션이라 먼저
 * 포인트 확인을 받는다.
 */
function requestGenerate() {
  if (!hasDrawing()) return flash('먼저 그림을 그려 주세요')
  const trimmedName = name.value.trim()
  if (!trimmedName) return flash('아이템 이름을 입력해 주세요')
  name.value = trimmedName

  if (pendingRetry.value) {
    pendingRetry.value = false
    void generateAgain()
    return
  }
  showPointConfirm.value = true
}

async function generate() {
  showPointConfirm.value = false
  attemptCount.value = 0
  generatedResults.value = []
  selectedResultJobId.value = null
  pendingRetry.value = false // 새 결제 세션 시작 — 이 시점엔 항상 false이지만 안전망으로 명시
  paidJobId.value = null // 새 결제 세션 시작 — 재생성 parentJobId 기준점을 초기화한다
  await generateAgain()
}

async function generateAgain() {
  attemptCount.value += 1
  openGenerating()
  await startJob(canvasToSketchBase64())
}

/**
 * 모달의 "다시 생성하기" — 모달만 닫는다. 캔버스도, 지금까지의 generatedResults(첫 결과)도
 * 그대로 둔다 — 유저가 그림을 고친 뒤(또는 그대로) "AI로 생성하기"를 다시 눌러야 2회차가
 * 시작된다. pendingRetry를 세워 두면 다음 생성 클릭 때 포인트 확인 모달을 건너뛴다
 * (이미 결제한 세션이므로).
 */
function retry() {
  if (!canRetry.value) return
  pendingRetry.value = true
  closeModal()
}

function openGenerating() {
  modalOpen.value = true
  phase.value = 'generating'
  jobStatus.value = ''
  resultImageUrl.value = null
  failMessage.value = ''
  currentJobId.value = null
}

/**
 * paidJobId가 없으면(이번 세션 첫 요청) parentJobId 없이 보내 새 결제로 처리되고, 응답받은
 * jobId를 paidJobId에 저장해 이후 재생성의 기준점으로 삼는다. paidJobId가 이미 있으면(재생성)
 * 그 값을 parentJobId로 실어 보내고 paidJobId 자체는 갱신하지 않는다(최초 결제 job을 계속 가리켜야 함).
 */
async function startJob(sketchBase64: string) {
  try {
    const job = await shopApi.createAiItem({
      name: name.value,
      category: category.value,
      sketchBase64,
      parentJobId: paidJobId.value ?? undefined,
    })
    currentJobId.value = job.jobId
    if (paidJobId.value === null) paidJobId.value = job.jobId
    jobStatus.value = job.status
    void syncPointBalance() // 최초 결제면 여기서 차감된다 — 헤더를 바로 맞춘다
    pollTimer = setTimeout(() => pollJob(job.jobId), POLL_INTERVAL_MS)
  } catch (e) {
    // 포인트 부족·재생성 한도 초과는 "생성 시도" 자체가 아니라 요청이 거부된 것이라, 생성 모달을
    // 닫고 토스트로 안내한다(그리기 화면에 머물러 있던 것처럼 보이게).
    if (e instanceof ApiError && e.code === 'AI_ITEM_INSUFFICIENT_POINT') {
      closeModal()
      flash('포인트가 부족해요. 화면 상단의 포인트 충전에서 채워보세요.')
      return
    }
    if (e instanceof ApiError && e.code === 'AI_ITEM_RETRY_LIMIT_EXCEEDED') {
      closeModal()
      flash('이미 다시 생성을 사용했어요.')
      return
    }
    failMessage.value = e instanceof ApiError ? e.message : '생성 요청에 실패했어요'
    phase.value = 'failed'
  }
}

/**
 * DONE/FAILED가 될 때까지 폴링한다. 일시적인 네트워크 오류로 개별 요청이 실패해도
 * 즉시 포기하지 않고 다음 회차를 시도하되, 연속 3회 실패하면 중단한다. 타임아웃·연속
 * 실패도 결국 "실패 상태"로 보낸다 — generating 단계는 닫을 수 없으므로, 어떤 경로로든
 * 종료 상태에 닿지 못하면 모달이 영영 안 닫힌다.
 */
async function pollJob(jobId: number, attempt = 0, consecutiveFailures = 0) {
  if (attempt >= POLL_MAX_ATTEMPTS) {
    // 서버에 방치된 job 자동 정리 스케줄러(AiItemJobTimeoutSweeper)가 있어 결국 FAILED로
    // 정리되고 환불된다 — 프론트가 포기하는 지금 시점엔 아직 서버가 처리 중일 수 있으므로
    // "실패했다"가 아니라 "지연되고 있다"로 안내한다.
    failMessage.value = '생성이 지연되고 있어요. 실패한 경우 포인트는 자동으로 돌려드리니, 잠시 후 인벤토리를 확인해 주세요.'
    phase.value = 'failed'
    return
  }

  let status
  try {
    status = await shopApi.getAiItemJob(jobId)
  } catch (e) {
    const failures = consecutiveFailures + 1
    if (failures >= POLL_MAX_CONSECUTIVE_FAILURES) {
      failMessage.value =
        e instanceof ApiError ? e.message : '생성 상태를 확인하지 못했어요. 잠시 후 인벤토리를 확인해 주세요'
      phase.value = 'failed'
      return
    }
    pollTimer = setTimeout(() => pollJob(jobId, attempt + 1, failures), POLL_INTERVAL_MS)
    return
  }

  jobStatus.value = status.status

  if (status.status === 'DONE') {
    if (!status.imageUrl) {
      failMessage.value = '생성된 이미지를 불러오지 못했어요'
      phase.value = 'failed'
      return
    }
    resultImageUrl.value = status.imageUrl
    const result = { jobId, imageUrl: status.imageUrl }
    generatedResults.value = [...generatedResults.value, result]
    selectedResultJobId.value = jobId
    phase.value = 'done'
    return
  }
  if (status.status === 'FAILED') {
    // 서버가 FAILED 전환과 환불을 같은 트랜잭션에서 처리하므로(AiItemJobService.fail), 이 시점엔
    // 이미 환불이 끝나 있다 — 어떤 사유든(워커 오류·타임아웃 정리) 환불 안내를 함께 보여준다.
    const reason = status.errorMessage ?? '생성에 실패했어요'
    failMessage.value = `${reason} 사용한 포인트는 자동으로 환불됐어요.`
    phase.value = 'failed'
    void syncPointBalance() // 서버가 같은 트랜잭션에서 환불을 마친 뒤라 여기서 최신값이 맞다
    return
  }

  pollTimer = setTimeout(() => pollJob(jobId, attempt + 1, 0), POLL_INTERVAL_MS)
}

/** "저장하기" — 이 호출로만 인벤토리에 지급된다. 성공하면 모달을 닫는다. */
async function save() {
  const jobId = selectedResultJobId.value
  if (!jobId || saving.value) return
  saving.value = true
  try {
    await shopApi.saveAiItem(jobId)
    flash('인벤토리에 저장됐어요!')
    closeModal()
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '저장에 실패했어요')
  } finally {
    saving.value = false
  }
}

/**
 * 헤더가 보는 세션 프로필 잔액을 서버 값으로 재동기화한다(ShopView.syncBalance와 같은 패턴).
 * 최초 결제 차감 직후·환불(FAILED) 직후에 불러 새로고침 없이 헤더 포인트가 맞게 보이도록 한다.
 * 실패해도 조용히 넘어간다 — 표시용이라 치명적이지 않고, 다음 페이지 진입 때 다시 맞춰진다.
 */
async function syncPointBalance() {
  try {
    const { pointBalance } = await usersApi.getPoints()
    if (session.profile) session.profile.pointBalance = pointBalance
  } catch {
    /* 잔액 조회 실패 — 기존 표시 값 유지 */
  }
}

function closeModal() {
  clearPollTimer()
  modalOpen.value = false
  currentJobId.value = null
}

/** 배경 클릭으로 닫힐 때 — 생성 중에는 무시한다(ESC는 PixelModal이 애초에 처리하지 않는다). */
function onBackdropClose() {
  if (phase.value === 'generating') return
  closeModal()
}

// 확인창(포인트 사용·그림 지우기)이 떠 있는 동안 뒤 페이지 스크롤을 막는다.
// 전용 컴포넌트가 아니라 이 화면 안의 v-if 블록이라 PixelModal 쪽 잠금이 닿지 않는다.
useScrollLockWhen(() => showPointConfirm.value || showClearConfirm.value)
</script>

<template>
  <AppPage class="ai-create-page" title="AI 아이템 만들기" subtitle="드로잉을 나만의 모션 아이템으로 완성해요" title-style="none" max-width="980px">
    <div class="grid creator-grid">
      <PixelCard class="drawing-card" title="드로잉">
        <div class="drawing-toolbar">
          <div class="tool-picker" role="group" aria-label="드로잉 도구">
            <button :class="{ active: drawingTool === 'pen' }" type="button" @click="selectTool('pen')">
              <span>✎</span> 연필
            </button>
            <button :class="{ active: drawingTool === 'eraser' }" type="button" @click="selectTool('eraser')">
              <span>⌫</span> 지우개
            </button>
            <button :class="{ active: drawingTool === 'fill' }" type="button" @click="selectTool('fill')">
              <span>▣</span> 채우기
            </button>
          </div>
          <div class="history-actions">
            <button type="button" :disabled="!canUndo" aria-label="실행 취소" @click="undo">↶</button>
            <button type="button" :disabled="!canRedo" aria-label="다시 실행" @click="redo">↷</button>
            <PixelButton @click="requestClear">전체 지우기</PixelButton>
          </div>
        </div>
        <div class="brush-controls">
          <label class="size-control" :class="{ 'is-hidden': drawingTool === 'fill' }">{{ drawingTool === 'eraser' ? '지우개 굵기' : '연필 굵기' }} <input v-model.number="brushSize" type="range" min="2" max="18" @input="applyDrawingTool" /></label>
          <div class="palette" :class="{ 'fill-palette': drawingTool === 'fill', 'is-hidden': drawingTool === 'eraser' }" aria-label="색상 팔레트">
            <button v-for="color in palette" :key="color" type="button" :class="{ active: brushColor === color }" :style="{ background: color }" :aria-label="`${color} 색상`" @click="selectColor(color)" />
          </div>
        </div>
        <canvas
          ref="canvas"
          width="360"
          height="300"
          class="pad"
          @pointerdown="down"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
          @pointerleave="up"
        />
      </PixelCard>

      <PixelCard class="settings-card" title="생성">
        <label class="field">
          이름
          <input v-model="name" maxlength="20" placeholder="예: 반짝 별" />
        </label>
        <label class="field">
          분류
          <div class="select-display">스티커</div>
        </label>
        <!-- 분류 select 임시 제거 — category를 'STICKER'로 고정(위 ref 기본값 그대로 사용).
             위 읽기전용 표시가 그 자리를 대신한다. 다른 분류를 다시 열 때를 위해
             원래 select UI는 지우지 않고 남겨둔다.
        <label class="field">
          분류
          <select v-model="category">
            <option value="MASK">가면</option>
            <option value="EFFECT">효과</option>
            <option value="STICKER">스티커</option>
            <option value="BACKGROUND">배경</option>
          </select>
        </label>
        -->
        <PixelButton variant="primary" size="lg" block :disabled="modalOpen" @click="requestGenerate">
          ✨ AI로 생성하기
        </PixelButton>
      </PixelCard>
    </div>

    <PixelModal v-if="modalOpen" variant="lobby" @close="onBackdropClose">
      <div class="ai-modal">
        <template v-if="phase === 'generating'">
          <div class="gen-visual">
            <img class="gen-cat" :src="aiDrawingCat" alt="그림을 그리고 있는 고양이" />
            <div class="gen-dots"><i /><i /><i /></div>
          </div>
          <b class="gen-title">{{ generatingLabel }}</b>
          <p class="gen-desc">AI가 그림을 아이템으로 바꾸고 있어요.<br />잠시만 기다려 주세요!</p>
        </template>

        <template v-else-if="phase === 'done'">
          <b class="modal-title">{{ generatedResults.length === 1 ? '아이템이 완성됐어요!' : '마음에 드는 결과를 골라 주세요' }}</b>
          <p class="result-guide">{{ generatedResults.length === 1 ? '이대로 만들거나, 한 번 더 생성해 볼 수 있어요.' : '선택한 결과만 인벤토리에 저장돼요.' }}</p>
          <div class="result-options" :class="{ compare: generatedResults.length > 1 }">
            <button
              v-for="(result, index) in generatedResults"
              :key="result.jobId"
              type="button"
              class="result-frame"
              :class="{ selected: selectedResultJobId === result.jobId }"
              @click="selectedResultJobId = result.jobId"
            >
              <img :src="result.imageUrl" :alt="`${index + 1}번째 생성 아이템`" />
              <span v-if="generatedResults.length > 1" class="result-badge">{{ index === 0 ? '첫 결과' : '다시 생성' }}</span>
            </button>
          </div>
          <div class="modal-actions">
            <PixelButton variant="primary" :disabled="saving || !selectedResult" @click="save">
              {{ saving ? '생성 중…' : generatedResults.length === 1 ? '이대로 생성' : '선택한 아이템 생성' }}
            </PixelButton>
            <PixelButton v-if="canRetry" @click="retry">다시 생성하기 <small>1회</small></PixelButton>
          </div>
        </template>

        <template v-else>
          <div class="fail-modal">
            <div class="fail-visual" aria-hidden="true"><span>!</span></div>
            <p class="fail-kicker">AI ITEM STUDIO</p>
            <b class="modal-title">앗, 생성에 실패했어요</b>
            <p class="gen-desc">{{ failMessage }}</p>
            <p class="fail-note">잠시 후 다시 시도해 보세요.</p>
            <PixelButton block @click="closeModal">그리기 화면으로 돌아가기</PixelButton>
          </div>
        </template>
      </div>
    </PixelModal>

    <div v-if="showPointConfirm" class="clear-confirm-backdrop" role="presentation" @click.self="showPointConfirm = false">
      <section class="point-confirm" role="dialog" aria-modal="true" aria-labelledby="point-confirm-title">
        <span class="point-confirm-coin">●</span>
        <p class="point-confirm-kicker">AI ITEM STUDIO</p>
        <h2 id="point-confirm-title">AI 제작권을 사용할까요?</h2>
        <div class="point-ticket"><span>AI ITEM PASS</span><b>{{ AI_ITEM_COST.toLocaleString() }} P</b><small>최대 2회 생성 · 최종 1개 선택</small></div>
        <p>{{ AI_ITEM_COST.toLocaleString() }} 포인트로 최대 2번까지 생성해 볼 수 있어요.<br />두 결과 중 마음에 드는 아이템 하나만 골라 저장할 수 있어요.</p>
        <div class="clear-confirm-actions">
          <PixelButton @click="showPointConfirm = false">취소</PixelButton>
          <PixelButton variant="primary" @click="generate">생성하기</PixelButton>
        </div>
      </section>
    </div>

    <div v-if="showClearConfirm" class="clear-confirm-backdrop" role="presentation" @click.self="showClearConfirm = false">
      <section class="clear-confirm" role="dialog" aria-modal="true" aria-labelledby="clear-confirm-title">
        <span class="clear-confirm-icon">!</span>
        <h2 id="clear-confirm-title">그림을 지울까요?</h2>
        <p>지운 그림은 되돌릴 수 없어요.</p>
        <div class="clear-confirm-actions">
          <PixelButton @click="showClearConfirm = false">취소</PixelButton>
          <PixelButton variant="primary" @click="clear">지우기</PixelButton>
        </div>
      </section>
    </div>

    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
.ai-hero { height: 130px; margin-bottom: 18px; padding: 18px 24px; display: flex; align-items: center; overflow: hidden; border: var(--border); border-radius: 20px; background: linear-gradient(115deg, #ded2ff, #ffe7cf); box-shadow: var(--shadow-lg); }
.ai-hero h2 { margin: 10px 0 5px; font-size: 16px; } .ai-hero p { margin: 0; color: var(--c-muted); font-size: 9px; }
.ai-hero img { width: 150px; margin-left: auto; transform: translateY(14px) rotate(4deg); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }

/* AI 생성 결과 모달 */
.ai-modal { padding: 3px; text-align: center; }
.modal-title { display: block; margin-bottom: 8px; color: #4b3429; font-family: var(--font-pixel); font-size: 15px; font-weight: 400; }
.gen-visual { position: relative; height: 112px; margin-bottom: 11px; }.gen-cat { display: block; width: 126px; height: 112px; margin: 0 auto; object-fit: contain; }
.gen-dots { position: absolute; left: 50%; bottom: 0; display: flex; gap: 7px; transform: translateX(-50%); }.gen-dots i { width: 9px; height: 9px; border: 2px solid #8e6049; border-radius: 50%; background: #dcecbf; animation: ai-dot-bounce 1s infinite ease-in-out; }
.gen-dots i:nth-child(2) { animation-delay: 0.15s; }
.gen-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes ai-dot-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-7px); }
}
@media (prefers-reduced-motion: reduce) {
  .gen-spark, .gen-dots i { animation: none; }
}
.gen-title { display: block; margin-bottom: 8px; color: #51382c; font-family: var(--font-pixel); font-size: 13px; font-weight: 400; }.gen-desc { margin: 0; color: #896e5d; font-size: 10px; line-height: 1.7; }
.fail-modal { padding: 5px 5px 2px; }
.fail-visual { width: 62px; height: 62px; margin: 0 auto 10px; display: grid; place-items: center; border: 3px solid #8d6048; border-radius: 50%; background: #f7df9e; box-shadow: 4px 4px 0 #c79b77; }
.fail-visual span { width: 39px; height: 39px; display: grid; place-items: center; border: 2px solid #b86755; border-radius: 50%; background: #fff8e9; color: #b86755; font-family: var(--font-pixel); font-size: 21px; line-height: 1; }
.fail-kicker { margin: 0 0 7px; color: #9a6045; font-family: var(--font-pixel); font-size: 8px; letter-spacing: .9px; }
.fail-modal .modal-title { margin-bottom: 9px; }
.fail-note { margin: 12px 0 14px; padding: 8px; border-top: 2px dashed #dfc29d; border-bottom: 2px dashed #dfc29d; color: #806454; font-size: 9px; }
.fail-modal :deep(.px-btn) { border: 2px solid #9a6b4f; border-radius: 6px; box-shadow: 3px 3px 0 #bd916e; }
.result-frame {
  width: 220px;
  height: 220px;
  margin: 0 auto 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: var(--border);
  border-radius: 12px;
  background-color: #fffdf3;
  background-image: linear-gradient(rgba(101,121,221,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(101,121,221,.08) 1px, transparent 1px);
  background-size: 18px 18px;
  overflow: hidden;
}
.result-frame img { width: 85%; height: 85%; object-fit: contain; }.result-frame { border: 3px solid #c79b77; border-radius: 9px; background-color: #fffdf4; background-image: linear-gradient(rgba(190,145,101,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(190,145,101,.12) 1px, transparent 1px); }
.result-options { display: flex; justify-content: center; margin-bottom: 18px; }.result-options.compare { gap: 10px; }.result-options.compare .result-frame { width: 150px; height: 150px; margin: 0; }
.result-frame { position: relative; padding: 0; cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; }.result-frame.selected { border-color: #9a6b4f; box-shadow: 4px 4px 0 #c99971; transform: translate(-2px, -2px); }.result-badge { position: absolute; top: 7px; left: 7px; padding: 4px 6px; border: 1px solid #8b5c42; border-radius: 4px; background: #fff0b5; color: #604131; font-size: 8px; }.result-guide { margin: -4px 0 12px; color: #896e5d; font-size: 10px; }
.modal-actions { display: flex; gap: 10px; }.modal-actions small { font-size: 8px; opacity: .75; }.modal-actions :deep(.px-btn) { border: 2px solid #9a6b4f; border-radius: 6px; box-shadow: 2px 2px 0 #bd916e; }
.modal-actions :deep(.px-btn) { flex: 1; }
.pad {
  width: 100%;
  border: var(--border);
  border-radius: 12px;
  background-color: #fffdf3;
  background-image: linear-gradient(rgba(101,121,221,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(101,121,221,.08) 1px, transparent 1px);
  background-size: 18px 18px;
  touch-action: none;
  margin-bottom: 12px;
  cursor: crosshair;
}
.tools { display: flex; gap: 8px; margin-bottom: 8px; }
.tool-btn {
  flex: 1;
  height: 38px;
  border: 2px solid var(--c-ink);
  border-radius: 10px;
  background: #fff;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 2px 2px 0 #d8c9d8;
  transition: var(--t-fast);
}
.tool-btn.active { background: var(--c-yellow); box-shadow: var(--shadow-sm); }
.field { display: block; margin-bottom: 14px; font-size: 9px; font-weight: 700; }
.field input, .field select {
  width: 100%; height: 44px; margin-top: 6px; padding: 0 12px;
  border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; outline: 0;
}
.hint { font-size: 9px; color: var(--c-muted); margin: 0 0 14px; line-height: 1.6; }

/* AI creator: a workshop board that matches the lobby and shop wood framing. */
/* 벽지는 공통 유틸(px-*-bg)이 그린다 — background 축약형으로 덮으면 도트까지 지워진다 */
.ai-create-page :deep(.app-page) { padding-top: 28px; padding-bottom: 48px; }
.ai-create-page :deep(.hero), .ai-create-page :deep(.body) { max-width: 980px; }
.ai-hero {
  position: relative;
  height: 164px;
  padding: 24px 30px;
  border: 3px solid #8d6048;
  border-radius: 14px;
  background:
    linear-gradient(rgba(255,255,255,.2) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.2) 1px, transparent 1px),
    linear-gradient(115deg, #c6edfb, #e2f2dc);
  background-size: 20px 20px, 20px 20px, auto;
  box-shadow: 5px 5px 0 #d4b48c;
}
.ai-hero::after { content: '✦'; position: absolute; right: 170px; top: 28px; color: #f2b94b; font-size: 28px; }
.ai-hero h2 { margin: 9px 0 6px; color: #493127; font-size: 22px; }
.ai-hero p { color: #695748; font-size: 11px; }
.ai-hero img { position: relative; z-index: 1; width: 172px; transform: translateY(20px) rotate(4deg); }
.creator-intro {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 0 0 18px;
  padding: 10px 16px;
  border: 2px dashed #d1ad7e;
  border-radius: 9px;
  background: #fffdf4;
  color: #806045;
  font-size: 11px;
}
.creator-intro i { color: #c37a5d; font-style: normal; }.creator-intro b { color: #8b5f9b; }
.creator-grid { gap: 22px; }
.drawing-card, .settings-card { border: 3px solid #9a6b4f; border-radius: 13px; background: #fffaf0; box-shadow: 5px 5px 0 #d5b28c; }
.drawing-card :deep(.card-head), .settings-card :deep(.card-head) { justify-content: space-between; padding-bottom: 11px; border-bottom: 2px solid #ead5b8; }
.drawing-card :deep(.card-head h2), .settings-card :deep(.card-head h2) { color: #4b3429; font-size: 18px; }
.panel-tag { padding: 4px 7px; border: 2px solid #b6825b; border-radius: 5px; background: #f5d889; color: #704b36; font-size: 8px; letter-spacing: 1px; }
.drawing-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin: -2px 0 12px; }.tool-picker { display: flex; gap: 7px; }
.tool-picker button { display: inline-flex; align-items: center; gap: 5px; height: 34px; padding: 0 11px; border: 2px solid #c8a17e; border-radius: 6px; background: #fffdf6; color: #73533e; font-size: 10px; transition: var(--t-fast); }
.tool-picker button span { font-size: 14px; line-height: 1; }.tool-picker button.active { border-color: #925c47; background: #f4cf77; box-shadow: inset 0 -3px rgba(146,92,71,.2); color: #4a3328; }.tool-picker button:hover { transform: translate(-1px, -1px); }
.brush-controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 12px; padding: 8px 10px; border: 2px solid #ead5b8; border-radius: 7px; background: #fffdf5; }
.size-control { display: flex; align-items: center; gap: 8px; color: #73533e; font-size: 9px; white-space: nowrap; }.size-control input { width: 86px; accent-color: #925c47; }
.palette { display: flex; align-items: center; gap: 5px; }.palette.fill-palette { margin-left: auto; }.is-hidden { visibility: hidden; pointer-events: none; }.palette button { width: 18px; height: 18px; padding: 0; border: 2px solid rgba(56,38,61,.35); border-radius: 50%; transition: transform .12s ease; }.palette button.active { outline: 2px solid #925c47; outline-offset: 2px; transform: scale(1.12); }
.pad { display: block; width: 100%; height: auto; aspect-ratio: 6 / 5; margin-bottom: 0; border: 3px solid #9a6b4f; border-radius: 8px; background-color: #fffef8; background-image: linear-gradient(rgba(132,180,195,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(132,180,195,.15) 1px, transparent 1px); cursor: crosshair; }
.history-actions { display: flex; align-items: center; gap: 6px; }.history-actions > button { display: grid; width: 30px; height: 30px; place-items: center; padding: 0; border: 2px solid #b98a67; border-radius: 6px; background: #fffdf5; color: #704c38; font-size: 17px; line-height: 1; }.history-actions :deep(.px-btn) { width: auto; min-width: 78px; padding: 0 9px; border-color: #9a6b4f; background: #f7e1ad; box-shadow: 2px 2px 0 #bd916e; color: #51382c; font-size: 9px; }.history-actions > button:disabled { opacity: .38; cursor: not-allowed; }.history-actions > button:not(:disabled):hover { transform: translate(-1px, -1px); box-shadow: 2px 2px 0 #d6b08b; }
.clear-confirm-backdrop { position: fixed; z-index: 30; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(62, 41, 29, .38); }
.clear-confirm { width: min(100%, 350px); padding: 28px 24px 22px; border: 3px solid #8b5c42; border-radius: 14px; background: #fff8e7; box-shadow: 6px 6px 0 #70452f; text-align: center; }
.point-confirm { width: min(100%, 370px); padding: 30px 24px 24px; border: 3px solid #8b5c42; border-radius: 14px; background: #fff8e9; box-shadow: 6px 6px 0 #70452f; text-align: center; }.point-confirm-coin { display: grid; width: 42px; height: 42px; margin: 0 auto 10px; place-items: center; border: 3px solid #9a6b3c; border-radius: 50%; background: #ffd65d; color: #fff1a1; font-size: 20px; box-shadow: inset 0 0 0 3px #f1b83d; }.point-confirm-kicker { margin: 0 0 9px; color: #a8704f; font-size: 8px; letter-spacing: 1px; }.point-confirm h2 { margin: 0; color: #503528; font-family: var(--font-pixel); font-size: 14px; font-weight: 400; }.point-ticket { display: grid; gap: 4px; margin: 15px 0 12px; padding: 10px; border: 2px dashed #b98a67; border-radius: 7px; background: #fffdf4; }.point-ticket span { color: #a8704f; font-size: 8px; letter-spacing: 1px; }.point-ticket b { color: #82533a; font-family: var(--font-pixel); font-size: 17px; font-weight: 400; }.point-ticket small { color: #8d705c; font-size: 9px; }.point-confirm > p:not(.point-confirm-kicker) { margin: 13px 0 21px; color: #7a604c; font-size: 10px; line-height: 1.7; }
.clear-confirm-icon { display: grid; width: 36px; height: 36px; margin: 0 auto 12px; place-items: center; border: 2px solid #a96a4e; border-radius: 50%; background: #f8cf80; color: #66402e; font-family: var(--font-pixel); font-size: 19px; }
.clear-confirm h2 { margin: 0; color: #503528; font-family: var(--font-pixel); font-size: 15px; font-weight: 400; }
.clear-confirm p { margin: 12px 0 20px; color: #896e5d; font-size: 11px; }
.clear-confirm-actions { display: flex; justify-content: center; gap: 9px; }.clear-confirm-actions :deep(.px-btn) { min-width: 94px; border-color: #9a6b4f; border-radius: 6px; box-shadow: 2px 2px 0 #bd916e; }.clear-confirm-actions :deep(.px-btn:first-child) { background: #f7e1ad; color: #51382c; }.clear-confirm-actions :deep(.px-btn:last-child) { background: #d98265; color: #fffaf0; }
.field { margin-bottom: 18px; color: #5e4031; font-size: 11px; }
.field input, .field select { height: 50px; margin-top: 8px; border: 2px solid #b98763; border-radius: 7px; background: #fffef9; font-size: 13px; }
.select-display { display: flex; align-items: center; width: 100%; height: 50px; margin-top: 8px; padding: 0 12px; border: 2px solid #b98763; border-radius: 7px; background: #fffef9; color: #5e4031; font-size: 13px; cursor: default; user-select: none; }
.hint { padding: 10px; border-radius: 7px; background: #f5ead6; color: #806d5c; font-size: 10px; }
.settings-card :deep(.v-primary) { border: 3px solid #925c47; border-radius: 7px; box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -3px 0 rgba(120,58,47,.2), 4px 4px 0 #a66b50; }
.settings-card :deep(.px-btn:hover:not(:disabled)) { transform: translate(-2px, -2px); box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -3px 0 rgba(120,58,47,.2), 4px 4px 0 #a66b50; }
.result { border-color: #a784bc; background: #fffaff; box-shadow: 5px 5px 0 #d7c5e4; }
@media (max-width: 720px) {
  .ai-create-page :deep(.app-page) { padding: 18px 14px 34px; }
  .ai-hero { height: 150px; padding: 20px; }.ai-hero h2 { font-size: 18px; }.ai-hero p { max-width: 65%; font-size: 9px; }.ai-hero img { width: 130px; transform: translate(8px, 28px) rotate(4deg); }.ai-hero::after { right: 125px; top: 22px; }
  .creator-intro { gap: 7px; padding: 9px; font-size: 9px; }.creator-grid { gap: 16px; }.drawing-toolbar { flex-wrap: wrap; }.history-actions { margin-left: auto; }.brush-controls { align-items: flex-start; flex-direction: column; gap: 8px; }.size-control input { width: 110px; }
}
</style>
