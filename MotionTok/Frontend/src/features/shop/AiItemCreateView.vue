<script setup lang="ts">
/**
 * AI 아이템 생성 (API §3 /shop/ai-items).
 * 드로잉 좌표(strokes)를 모아 AI에 전달 → 아이템 생성.
 * 초안: 마우스/터치로 캔버스에 그리기 → strokes 수집. (실제 모션 드로잉은 게임 모듈에서 대체)
 */
import { onMounted, ref } from 'vue'
import { shopApi, ApiError, type ItemCategory } from '@/api'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useToast } from '@/composables/useToast'

const { message: toast, flash } = useToast()

const canvas = ref<HTMLCanvasElement>()
const name = ref('')
const category = ref<ItemCategory>('STICKER')
const loading = ref(false)

// strokes: 획 단위 좌표 시퀀스
const strokes: { x: number; y: number }[][] = []
let current: { x: number; y: number }[] | null = null
let ctx: CanvasRenderingContext2D | null = null

onMounted(() => {
  const el = canvas.value!
  ctx = el.getContext('2d')
  if (ctx) {
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#38263d'
  }
})

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

async function generate() {
  if (strokes.length === 0) return flash('먼저 그림을 그려 주세요')
  loading.value = true
  try {
    const item = await shopApi.createAiItem({
      name: name.value || undefined,
      strokes,
      category: category.value,
    })
    flash(`"${item.name}" 아이템이 생성되었어요!`)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '생성 실패 (백엔드 미연동)')
  } finally {
    loading.value = false
  }
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
          <input v-model="name" placeholder="예: 반짝 별" />
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
          {{ loading ? '생성 중…' : '✨ AI로 생성하기' }}
        </PixelButton>
      </PixelCard>
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
