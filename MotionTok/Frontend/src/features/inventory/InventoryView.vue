<script setup lang="ts">
/**
 * 인벤토리 + 화면 꾸미기 (API §2 /users/me/inventory, /users/me/decoration).
 * 보유 아이템을 장착하고, 카메라 미리보기 위에서 끌어 위치를 정한 뒤 저장한다.
 * 저장한 배치는 게임룸에서 카메라 영상에 합성돼 다른 참가자에게도 보인다.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type InventoryItem, type ItemCategory } from '@/api'
import { useCamera } from '@/composables/useCamera'
import { EQUIP_LIMIT, useDecoration } from '@/composables/useDecoration'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useToast } from '@/composables/useToast'
import StickerOverlay from '@/features/decor/StickerOverlay.vue'
import { getLoadedImage, scaleLimits } from '@/features/decor/sticker'

const { message: toast, flash } = useToast()

const emojiOf: Record<ItemCategory, string> = { MASK: '🎭', EFFECT: '✨', STICKER: '🌟', BACKGROUND: '🌌' }
const CATEGORY_ORDER: ItemCategory[] = ['MASK', 'EFFECT', 'STICKER', 'BACKGROUND']
const CATEGORY_LABEL: Record<ItemCategory, string> = { MASK: '가면', EFFECT: '효과', STICKER: '스티커', BACKGROUND: '배경' }

// ── 데이터 ────────────────────────────────────────────────
// 보유 목록·배치·장착 토글은 공용 컴포저블이 맡고, 이 화면은 그 위에 편집(끌기·크기·저장)을 얹는다.
const {
  inventory, placements, sprites, equippedCount,
  loading, saving, dirty, error,
  load, setEquipped, canEquip, move, setScale, save,
} = useDecoration()
/**
 * 목록을 못 불러온 상태만 따로 붙든다 — 장착 실패 같은 개별 오류까지 큰 배너로 띄우면
 * 화면이 통째로 못 쓰는 것처럼 보인다(그건 토스트로 알린다).
 */
const loadError = ref<string | null>(null)

async function reload() {
  await load()
  loadError.value = error.value
}
onMounted(reload)

const grouped = computed(() =>
  CATEGORY_ORDER.map((cat) => ({
    cat,
    label: CATEGORY_LABEL[cat],
    items: inventory.value.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0),
)

// ── 카메라 미리보기 ────────────────────────────────────────
// 자동으로 켜지 않는다 — 인벤토리를 열었을 뿐인데 카메라 권한을 묻는 건 과하다.
// 카메라가 없어도 같은 비율의 자리표시 배경 위에서 위치를 정할 수 있다.
const camera = useCamera()
const videoEl = ref<HTMLVideoElement>()
// 크기 제한(원본 이상 확대 금지·최소 픽셀)이 프레임 픽셀 기준이라 비율만으로는 부족하다.
// 카메라를 켜기 전에는 게임룸과 같은 제약값(640x400)을 가정한다.
const frameW = ref(640)
const frameH = ref(400)
const aspect = computed(() => frameW.value / frameH.value)

watch([() => camera.stream.value, videoEl], ([stream, el], _prev, onCleanup) => {
  if (!el || !stream) return
  el.srcObject = stream
  onCleanup(() => {
    el.srcObject = null
  })
})

/** 좌표가 프레임 기준이라 미리보기 박스도 영상과 같은 비율이어야 위치가 어긋나지 않는다. */
function onVideoMeta() {
  const el = videoEl.value
  if (!el?.videoWidth || !el.videoHeight) return
  frameW.value = el.videoWidth
  frameH.value = el.videoHeight
}

async function startCamera() {
  const stream = await camera.start({ video: { width: 640, height: 400 }, audio: false })
  if (!stream) flash('카메라 권한을 허용해 주세요')
}
onBeforeUnmount(() => camera.stop())

// ── 편집 ────────────────────────────────────────────────
const selectedId = ref<number | null>(null)
const selected = computed(() => placements.value.find((p) => p.itemId === selectedId.value) ?? null)

/** 슬라이더 범위는 스티커마다 다르다 — 상한은 원본 이미지 크기, 하한은 최소 표시 픽셀. */
const scaleRange = computed(() => {
  const sprite = sprites.value.find((s) => s.itemId === selectedId.value)
  const natural = sprite ? (getLoadedImage(sprite.imageUrl)?.naturalWidth ?? 0) : 0
  return scaleLimits(frameW.value, frameH.value, natural)
})

function onScale(value: number) {
  if (selectedId.value !== null) setScale(selectedId.value, value)
}

async function toggle(item: InventoryItem) {
  const next = !item.equipped
  if (!(await setEquipped(item.itemId, next))) {
    flash(error.value ?? '장착 상태를 바꾸지 못했어요')
    return
  }
  if (next) selectedId.value = item.itemId
  else if (selectedId.value === item.itemId) selectedId.value = null
}

async function saveDecoration() {
  flash((await save()) ? '화면 꾸미기를 저장했어요' : (error.value ?? '저장하지 못했어요'))
}
</script>

<template>
  <AppPage title="인벤토리 · 화면 꾸미기" subtitle="보유 아이템을 장착하고 카메라에 붙일 자리를 정해요">
    <template #actions>
      <PixelButton variant="primary" :disabled="saving || !!loadError" @click="saveDecoration">
        {{ saving ? '저장 중…' : dirty ? '꾸미기 저장 *' : '꾸미기 저장' }}
      </PixelButton>
    </template>

    <p v-if="loadError" class="load-error">
      <span>{{ loadError }}</span>
      <PixelButton @click="reload">다시 시도</PixelButton>
    </p>

    <div class="grid">
      <PixelCard title="미리보기">
        <div class="preview">
          <!-- 상대에게 보이는 방향 그대로 보여 준다(좌우 반전 없음) — 반전된 화면에서 자리를 잡으면
               저장된 좌표와 상대가 보는 위치가 뒤집힌다. -->
          <div class="cam" :style="{ aspectRatio: String(aspect) }">
            <video
              v-show="camera.isOn.value"
              ref="videoEl"
              autoplay
              playsinline
              muted
              @loadedmetadata="onVideoMeta"
            />
            <div v-if="!camera.isOn.value" class="cam-placeholder">
              <img src="/assets/intro/person.png" alt="" />
              <PixelButton @click="startCamera">📷 카메라 켜기</PixelButton>
            </div>
            <StickerOverlay
              :sprites="sprites"
              editable
              :selected-id="selectedId"
              @move="move"
              @select="selectedId = $event"
            />
          </div>

          <p class="hint">스티커를 끌어 자리를 정하세요. 상대에게 보이는 방향 그대로입니다.</p>

          <div v-if="selected" class="size-row">
            <label for="scale">크기</label>
            <input
              id="scale"
              type="range"
              :min="scaleRange.min"
              :max="scaleRange.max"
              step="0.005"
              :value="Math.min(selected.scale, scaleRange.max)"
              @input="onScale(Number(($event.target as HTMLInputElement).value))"
            />
            <!-- 원본 크기가 상한이라 100%는 "원본 그대로"를 뜻한다 -->
            <span class="size-val">{{ Math.round((Math.min(selected.scale, scaleRange.max) / scaleRange.max) * 100) }}%</span>
          </div>

          <div class="equipped">
            <button
              v-for="p in placements"
              :key="p.itemId"
              class="badge"
              :class="{ on: selectedId === p.itemId }"
              @click="selectedId = p.itemId"
            >
              {{ inventory.find((i) => i.itemId === p.itemId)?.name ?? p.itemId }}
            </button>
            <span v-if="placements.length === 0" class="empty">장착된 아이템이 없어요</span>
          </div>
        </div>
      </PixelCard>

      <PixelCard title="보유 아이템">
        <p v-if="loading" class="empty-inv">불러오는 중…</p>
        <div v-for="g in grouped" :key="g.cat" class="cat-group">
          <div class="cat-head">
            <span class="cat-emoji">{{ emojiOf[g.cat] }}</span>
            <span class="cat-label">{{ g.label }}</span>
            <span class="cat-count">{{ g.items.length }}</span>
            <!-- 장착 한도 — 스티커 5개, 가면·효과·배경 각 1개 -->
            <span class="cat-limit">장착 {{ equippedCount[g.cat] ?? 0 }} / {{ EQUIP_LIMIT[g.cat] }}</span>
          </div>
          <p v-if="g.cat !== 'STICKER'" class="cat-note">
            {{ CATEGORY_LABEL[g.cat] }}은(는) 아직 추적 부착을 지원하지 않아 화면 고정으로만 붙습니다.
          </p>
          <div class="items">
            <article v-for="item in g.items" :key="item.itemId" class="item" :class="{ on: item.equipped }">
              <div class="thumb">
                <img v-if="item.imageUrl" :src="item.imageUrl" alt="" />
                <span v-else>{{ emojiOf[item.category] }}</span>
              </div>
              <div class="name">{{ item.name }}</div>
              <PixelButton
                :variant="item.equipped ? 'mint' : 'secondary'"
                :disabled="!canEquip(item)"
                :title="canEquip(item) ? '' : `${CATEGORY_LABEL[item.category]}은(는) 최대 ${EQUIP_LIMIT[item.category]}개까지 장착할 수 있어요`"
                @click="toggle(item)"
              >
                {{ item.equipped ? '장착됨' : '장착' }}
              </PixelButton>
            </article>
          </div>
        </div>
        <p v-if="!loading && grouped.length === 0" class="empty-inv">
          보유한 아이템이 없어요. 상점에서 구매해보세요!
        </p>
      </PixelCard>
    </div>
    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 340px 1fr; gap: 18px; }
@media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }

.load-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 14px; padding: 11px 14px; border: 2px solid var(--c-ink); border-radius: 12px; background: #ffe9e4; font-size: 11px; }

.preview { text-align: center; }
.cam { position: relative; overflow: hidden; border: var(--border); border-radius: var(--radius-md); background: linear-gradient(135deg, #dff3ee, #fff0c4); }
.cam video { width: 100%; height: 100%; object-fit: cover; display: block; }
.cam-placeholder { position: absolute; inset: 0; display: grid; place-items: center; align-content: center; gap: 8px; }
.cam-placeholder img { width: 55%; opacity: 0.5; }
.hint { margin: 10px 0 0; font-size: 9px; color: var(--c-muted); line-height: 1.6; }

.size-row { display: flex; align-items: center; gap: 9px; margin-top: 10px; font-size: 10px; }
.size-row input { flex: 1; }
.size-val { min-width: 34px; font-weight: 700; }

.equipped { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 12px; }
.badge { font-size: 9px; padding: 5px 8px; border: 2px solid var(--c-ink); border-radius: 999px; background: var(--c-mint-soft); }
.badge.on { background: var(--c-yellow); font-weight: 700; }
.empty { font-size: 10px; color: var(--c-muted); }

.cat-group + .cat-group { margin-top: 20px; }
.cat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--c-ink);
}
.cat-limit { margin-left: auto; font-size: 9px; color: var(--c-muted); font-weight: 700; }
.cat-emoji { font-size: 16px; }
.cat-label { font-size: 13px; font-weight: 700; }
.cat-count {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: grid;
  place-items: center;
  border: 2px solid var(--c-ink);
  border-radius: 999px;
  background: var(--c-yellow);
  font-size: 9px;
  font-weight: 700;
}
.cat-note { margin: -4px 0 10px; font-size: 9px; color: var(--c-muted); }

.items { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.item { border: 2px solid var(--c-ink); border-radius: 14px; background: #fff; box-shadow: var(--shadow-sm); padding: 12px; text-align: center; }
.item.on { background: #f5fbf8; border-color: var(--c-mint); }
.thumb { height: 70px; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 8px; margin-bottom: 8px; border-radius: 10px; background: linear-gradient(135deg, var(--tone-4), #fff5d6); font-size: 36px; }
.thumb img { width: 100%; height: 100%; object-fit: contain; }
.name { font-size: 11px; font-weight: 700; margin-bottom: 10px; }
.empty-inv { text-align: center; color: var(--c-muted); font-size: 11px; padding: 20px; }
</style>
