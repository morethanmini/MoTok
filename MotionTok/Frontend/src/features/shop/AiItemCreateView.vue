<script setup lang="ts">
/**
 * AI 아이템 생성 (API §3 /shop/ai-items, -102).
 * GPU 워커가 폴링해 비동기로 처리하므로, POST는 jobId만 즉시 돌려주고
 * DONE/FAILED가 될 때까지 GET /shop/ai-items/{jobId}를 주기적으로 확인해야 한다.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { shopApi, ApiError, type AiItemJobStatus, type ItemCategory } from '@/api'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useToast } from '@/composables/useToast'

const POLL_INTERVAL_MS = 1500
const POLL_MAX_ATTEMPTS = 40 // 1.5s * 40 = 60초
const POLL_MAX_CONSECUTIVE_FAILURES = 3

const { message: toast, flash } = useToast()

const canvas = ref<HTMLCanvasElement>()
const name = ref('')
const category = ref<ItemCategory>('STICKER')
const loading = ref(false)
const jobStatus = ref<AiItemJobStatus | ''>('')
const resultImageUrl = ref<string | null>(null)
const showClearConfirm = ref(false)
type DrawingTool = 'pen' | 'eraser' | 'fill'
const drawingTool = ref<DrawingTool>('pen')
const brushSize = ref(4)
const brushColor = ref('#38263d')
const palette = ['#38263d', '#ef6872', '#f2b94b', '#48c8a4', '#6579dd', '#9a72d8']

// strokes: 그림이 있는지 여부만 판단하는 용도(서버에는 sketchBase64로 보낸다)
const strokes: { x: number; y: number }[][] = []
let current: { x: number; y: number }[] | null = null
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
  ctx = el.getContext('2d')
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
  strokes.length = 0
  const el = canvas.value!
  ctx?.clearRect(0, 0, el.width, el.height)
  history = []
  historyIndex.value = -1
  historyLength.value = 0
  saveHistory()
  showClearConfirm.value = false
}

const buttonLabel = computed(() => {
  if (!loading.value) return '✨ AI로 생성하기'
  if (jobStatus.value === 'PENDING') return '대기 중…'
  if (jobStatus.value === 'PROCESSING') return '그리는 중…'
  return '생성 중…'
})

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

async function generate() {
  if (historyIndex.value <= 0) return flash('먼저 그림을 그려 주세요')
  const trimmedName = name.value.trim()
  if (!trimmedName) return flash('아이템 이름을 입력해 주세요')

  loading.value = true
  jobStatus.value = ''
  resultImageUrl.value = null
  try {
    const job = await shopApi.createAiItem({
      name: trimmedName,
      category: category.value,
      sketchBase64: canvasToSketchBase64(),
    })
    jobStatus.value = job.status
    pollTimer = setTimeout(() => pollJob(job.jobId), POLL_INTERVAL_MS)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '생성 요청에 실패했어요')
    loading.value = false
  }
}

/**
 * DONE/FAILED가 될 때까지 폴링한다. 일시적인 네트워크 오류로 개별 요청이 실패해도
 * 즉시 포기하지 않고 다음 회차를 시도하되, 연속 3회 실패하면 중단한다.
 */
async function pollJob(jobId: number, attempt = 0, consecutiveFailures = 0) {
  if (attempt >= POLL_MAX_ATTEMPTS) {
    flash('생성이 오래 걸리고 있어요. 잠시 후 인벤토리를 확인해 주세요')
    loading.value = false
    return
  }

  let status
  try {
    status = await shopApi.getAiItemJob(jobId)
  } catch (e) {
    const failures = consecutiveFailures + 1
    if (failures >= POLL_MAX_CONSECUTIVE_FAILURES) {
      flash(e instanceof ApiError ? e.message : '생성 상태를 확인하지 못했어요. 잠시 후 인벤토리를 확인해 주세요')
      loading.value = false
      return
    }
    pollTimer = setTimeout(() => pollJob(jobId, attempt + 1, failures), POLL_INTERVAL_MS)
    return
  }

  jobStatus.value = status.status

  if (status.status === 'DONE') {
    resultImageUrl.value = status.imageUrl
    flash('아이템이 생성되었어요!')
    loading.value = false
    return
  }
  if (status.status === 'FAILED') {
    flash(status.errorMessage ?? '생성에 실패했어요')
    loading.value = false
    return
  }

  pollTimer = setTimeout(() => pollJob(jobId, attempt + 1, 0), POLL_INTERVAL_MS)
}
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
          <select v-model="category">
            <option value="MASK">가면</option>
            <option value="EFFECT">효과</option>
            <option value="STICKER">스티커</option>
            <option value="BACKGROUND">배경</option>
          </select>
        </label>
        <PixelButton variant="primary" size="lg" block :disabled="loading" @click="generate">
          {{ buttonLabel }}
        </PixelButton>
      </PixelCard>
    </div>

    <PixelCard v-if="resultImageUrl" title="생성 결과" class="result">
      <img :src="resultImageUrl" alt="생성된 아이템" />
    </PixelCard>

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
.result { margin-top: 18px; text-align: center; }
.result img { width: 160px; height: 160px; object-fit: contain; }
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
.field { display: block; margin-bottom: 14px; font-size: 9px; font-weight: 700; }
.field input, .field select {
  width: 100%; height: 44px; margin-top: 6px; padding: 0 12px;
  border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; outline: 0;
}
.hint { font-size: 9px; color: var(--c-muted); margin: 0 0 14px; line-height: 1.6; }

/* AI creator: a workshop board that matches the lobby and shop wood framing. */
.ai-create-page { background: #fff8e9; }
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
.clear-confirm-icon { display: grid; width: 36px; height: 36px; margin: 0 auto 12px; place-items: center; border: 2px solid #a96a4e; border-radius: 50%; background: #f8cf80; color: #66402e; font-family: var(--font-pixel); font-size: 19px; }
.clear-confirm h2 { margin: 0; color: #503528; font-family: var(--font-pixel); font-size: 15px; font-weight: 400; }
.clear-confirm p { margin: 12px 0 20px; color: #896e5d; font-size: 11px; }
.clear-confirm-actions { display: flex; justify-content: center; gap: 9px; }.clear-confirm-actions :deep(.px-btn) { min-width: 94px; border-color: #9a6b4f; border-radius: 6px; box-shadow: 2px 2px 0 #bd916e; }.clear-confirm-actions :deep(.px-btn:first-child) { background: #f7e1ad; color: #51382c; }.clear-confirm-actions :deep(.px-btn:last-child) { background: #d98265; color: #fffaf0; }
.field { margin-bottom: 18px; color: #5e4031; font-size: 11px; }
.field input, .field select { height: 50px; margin-top: 8px; border: 2px solid #b98763; border-radius: 7px; background: #fffef9; font-size: 13px; }
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
