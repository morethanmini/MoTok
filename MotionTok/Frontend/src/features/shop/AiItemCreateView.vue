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

// strokes: 그림이 있는지 여부만 판단하는 용도(서버에는 sketchBase64로 보낸다)
const strokes: { x: number; y: number }[][] = []
let current: { x: number; y: number }[] | null = null
let ctx: CanvasRenderingContext2D | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  const el = canvas.value!
  ctx = el.getContext('2d')
  if (ctx) {
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#38263d'
  }
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
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}
function down(e: PointerEvent) {
  current = []
  strokes.push(current)
  const p = pos(e)
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
  current = null
}
function clear() {
  strokes.length = 0
  const el = canvas.value!
  ctx?.clearRect(0, 0, el.width, el.height)
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
  if (strokes.length === 0) return flash('먼저 그림을 그려 주세요')
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
  <AppPage title="AI 아이템 만들기" subtitle="그림을 그리면 AI가 나만의 아이템으로 만들어줘요" max-width="720px">
    <template #hero>
      <section class="ai-hero">
        <div><span class="px-kicker">DRAW · CREATE · PLAY</span><h2>낙서가 게임 아이템이 되는 마법!</h2><p>떠오르는 모양을 자유롭게 그려보세요.</p></div>
        <img src="/assets/intro/sketchbook.png" alt="드로잉 스케치북" />
      </section>
    </template>
    <div class="grid">
      <PixelCard title="드로잉">
        <canvas
          ref="canvas"
          width="360"
          height="300"
          class="pad"
          @pointerdown="down"
          @pointermove="move"
          @pointerup="up"
          @pointerleave="up"
        />
        <PixelButton block @click="clear">지우기</PixelButton>
      </PixelCard>

      <PixelCard title="설정">
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
        <p class="hint">포인트가 소모되며, 생성된 아이템은 인벤토리에 바로 지급돼요.</p>
        <PixelButton variant="mint" size="lg" block :disabled="loading" @click="generate">
          {{ buttonLabel }}
        </PixelButton>
      </PixelCard>
    </div>

    <PixelCard v-if="resultImageUrl" title="생성 결과" class="result">
      <img :src="resultImageUrl" alt="생성된 아이템" />
    </PixelCard>

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
</style>
