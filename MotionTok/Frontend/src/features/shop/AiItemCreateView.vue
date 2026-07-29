<script setup lang="ts">
/**
 * AI 아이템 생성 (API §3 /shop/ai-items, -102) — "생성 → 확인 → 저장" 흐름.
 * GPU 워커가 폴링해 비동기로 처리하므로, POST는 jobId만 즉시 돌려주고
 * DONE/FAILED가 될 때까지 GET /shop/ai-items/{jobId}를 주기적으로 확인해야 한다.
 * 생성만으로는 인벤토리에 들어가지 않는다 — 결과를 모달로 보여주고, 유저가
 * "저장하기"를 눌러 POST /shop/ai-items/{jobId}/save를 호출해야 지급된다.
 */
import { computed, onUnmounted, onMounted, ref } from 'vue'
import { shopApi, ApiError, type AiItemJobStatus, type ItemCategory } from '@/api'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import { useToast } from '@/composables/useToast'

const POLL_INTERVAL_MS = 1500
const POLL_MAX_ATTEMPTS = 40 // 1.5s * 40 = 60초
const POLL_MAX_CONSECUTIVE_FAILURES = 3
/** 총 시도 횟수 = 최초 생성 1회 + 재시도 1회. 재시도는 첫 결과에서만 노출한다. */
const MAX_ATTEMPTS = 2

const { message: toast, flash } = useToast()

const canvas = ref<HTMLCanvasElement>()
const name = ref('')
const category = ref<ItemCategory>('STICKER')
const tool = ref<'pen' | 'eraser'>('pen')

// 모달 상태 — generating(생성 중, 닫기 불가) / done(결과 확인) / failed(실패, 닫기 가능)
const modalOpen = ref(false)
const phase = ref<'generating' | 'done' | 'failed'>('generating')
const jobStatus = ref<AiItemJobStatus | ''>('')
const resultImageUrl = ref<string | null>(null)
const failMessage = ref('')
const currentJobId = ref<number | null>(null)
const attemptCount = ref(0)
const saving = ref(false)

const PEN_WIDTH = 4
const ERASER_WIDTH = 10 // 펜의 2.5배 — 얇으면 지운 자리에 실수로 픽셀이 남기 쉽다

let drawing = false
let ctx: CanvasRenderingContext2D | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  const el = canvas.value!
  ctx = el.getContext('2d')
  if (ctx) {
    ctx.lineWidth = PEN_WIDTH
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
  if (!ctx) return
  drawing = true
  // 지우개는 흰색으로 덧칠하지 않고 실제 픽셀(알파)을 지운다 — toDataURL 전 흰 배경을 깔 때
  // 흰 덧칠 방식이면 그 위에 다시 흰 배경이 깔려도 문제없어 보이지만, 배경색이 바뀌면 지운 자국이
  // 그대로 드러난다. destination-out으로 진짜 투명하게 지워야 배경색과 무관하게 안전하다.
  ctx.globalCompositeOperation = tool.value === 'eraser' ? 'destination-out' : 'source-over'
  ctx.lineWidth = tool.value === 'eraser' ? ERASER_WIDTH : PEN_WIDTH
  const p = pos(e)
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
}
function move(e: PointerEvent) {
  if (!drawing || !ctx) return
  const p = pos(e)
  ctx.lineTo(p.x, p.y)
  ctx.stroke()
}
function up() {
  if (!ctx) return
  drawing = false
  ctx.globalCompositeOperation = 'source-over' // 다음 그리기에 지우개 모드가 새지 않도록 반드시 복귀
}
function clear() {
  const el = canvas.value!
  ctx?.clearRect(0, 0, el.width, el.height)
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
 * "AI로 생성하기" — 검증 후 모달을 열고 생성을 시작한다. attemptCount는 "다시 만들기"로
 * 모달을 닫은 뒤 다시 눌렀을 때도 이어서 올라간다(재시도 후 2회차가 되도록) — 페이지를
 * 벗어나기 전까진 초기화하지 않는다.
 */
async function generate() {
  if (!hasDrawing()) return flash('먼저 그림을 그려 주세요')
  const trimmedName = name.value.trim()
  if (!trimmedName) return flash('아이템 이름을 입력해 주세요')
  name.value = trimmedName

  attemptCount.value += 1
  openGenerating()
  await startJob(canvasToSketchBase64())
}

/**
 * 모달의 "다시 만들기" — 이번 결과는 저장하지 않고 버리고 모달만 닫는다. 캔버스는 그대로
 * 남으므로 유저가 그림을 고친 뒤 "AI로 생성하기"를 다시 누르면 새 job이 만들어진다(2회차).
 */
function retry() {
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

async function startJob(sketchBase64: string) {
  try {
    const job = await shopApi.createAiItem({
      name: name.value,
      category: category.value,
      sketchBase64,
    })
    currentJobId.value = job.jobId
    jobStatus.value = job.status
    pollTimer = setTimeout(() => pollJob(job.jobId), POLL_INTERVAL_MS)
  } catch (e) {
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
    failMessage.value = '생성이 오래 걸리고 있어요. 잠시 후 인벤토리를 확인해 주세요'
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
    resultImageUrl.value = status.imageUrl
    phase.value = 'done'
    return
  }
  if (status.status === 'FAILED') {
    failMessage.value = status.errorMessage ?? '생성에 실패했어요'
    phase.value = 'failed'
    return
  }

  pollTimer = setTimeout(() => pollJob(jobId, attempt + 1, 0), POLL_INTERVAL_MS)
}

/** "저장하기" — 이 호출로만 인벤토리에 지급된다. 성공하면 모달을 닫는다. */
async function save() {
  if (!currentJobId.value || saving.value) return
  saving.value = true
  try {
    await shopApi.saveAiItem(currentJobId.value)
    flash('인벤토리에 저장됐어요!')
    closeModal()
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '저장에 실패했어요')
  } finally {
    saving.value = false
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
        <div class="tools">
          <button type="button" class="tool-btn" :class="{ active: tool === 'pen' }" @click="tool = 'pen'">
            ✏️ 펜
          </button>
          <button type="button" class="tool-btn" :class="{ active: tool === 'eraser' }" @click="tool = 'eraser'">
            🧹 지우개
          </button>
        </div>
        <PixelButton block @click="clear">전체 지우기</PixelButton>
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
        <p class="hint">포인트가 소모되며, 결과를 확인하고 저장을 눌러야 인벤토리에 지급돼요.</p>
        <PixelButton variant="mint" size="lg" block :disabled="modalOpen" @click="generate">
          ✨ AI로 생성하기
        </PixelButton>
      </PixelCard>
    </div>

    <PixelModal v-if="modalOpen" @close="onBackdropClose">
      <div class="ai-modal">
        <template v-if="phase === 'generating'">
          <div class="gen-visual">
            <span class="gen-spark">✨</span>
            <div class="gen-dots"><i /><i /><i /></div>
          </div>
          <b class="gen-title">{{ generatingLabel }}</b>
          <p class="gen-desc">AI가 그림을 아이템으로 바꾸고 있어요.<br />잠시만 기다려 주세요!</p>
        </template>

        <template v-else-if="phase === 'done'">
          <b class="modal-title">짜잔, 이렇게 만들어졌어요!</b>
          <div class="result-frame">
            <img :src="resultImageUrl ?? ''" alt="생성된 아이템" />
          </div>
          <div class="modal-actions">
            <PixelButton variant="mint" :disabled="saving" @click="save">
              {{ saving ? '저장 중…' : '저장하기' }}
            </PixelButton>
            <PixelButton v-if="canRetry" @click="retry">다시 만들기</PixelButton>
          </div>
        </template>

        <template v-else>
          <b class="modal-title">앗, 생성에 실패했어요</b>
          <p class="gen-desc">{{ failMessage }}</p>
          <PixelButton block @click="closeModal">닫기</PixelButton>
        </template>
      </div>
    </PixelModal>

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
.ai-modal { text-align: center; }
.modal-title { display: block; margin-bottom: 14px; font-size: 14px; }
.gen-visual { position: relative; height: 74px; margin-bottom: 14px; }
.gen-spark { position: absolute; left: 50%; top: 0; font-size: 30px; transform: translateX(-50%); animation: px-twinkle 1.4s steps(2) infinite; }
.gen-dots { position: absolute; left: 50%; bottom: 0; display: flex; gap: 7px; transform: translateX(-50%); }
.gen-dots i { width: 10px; height: 10px; border: 2px solid var(--c-ink); border-radius: 50%; background: var(--c-mint); animation: ai-dot-bounce 1s infinite ease-in-out; }
.gen-dots i:nth-child(2) { animation-delay: 0.15s; }
.gen-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes ai-dot-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-7px); }
}
@media (prefers-reduced-motion: reduce) {
  .gen-spark, .gen-dots i { animation: none; }
}
.gen-title { display: block; margin-bottom: 8px; font-size: 14px; }
.gen-desc { margin: 0; color: var(--c-muted); font-size: 10px; line-height: 1.7; }
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
.result-frame img { width: 85%; height: 85%; object-fit: contain; }
.modal-actions { display: flex; gap: 10px; }
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
</style>
