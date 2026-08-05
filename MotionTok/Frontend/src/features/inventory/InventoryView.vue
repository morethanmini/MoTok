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
import { useFaceAnchor } from '@/composables/useFaceAnchor'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useToast } from '@/composables/useToast'
import StickerOverlay from '@/features/decor/StickerOverlay.vue'
import EffectIntensitySlider from '@/features/decor/EffectIntensitySlider.vue'
import CameraEffectLayer from '@/features/decor/CameraEffectLayer.vue'
import { EFFECT_LABEL, hasGlowLayer, videoFilter } from '@/features/decor/cameraEffect'


const { message: toast, flash } = useToast()

const CATEGORY_ORDER: ItemCategory[] = ['MASK', 'EFFECT', 'STICKER', 'BACKGROUND']
const CATEGORY_LABEL: Record<ItemCategory, string> = { MASK: '가면', EFFECT: '효과', STICKER: '스티커', BACKGROUND: '배경' }

// ── 데이터 ────────────────────────────────────────────────
// 보유 목록·배치·장착 토글은 공용 컴포저블이 맡고, 이 화면은 그 위에 편집(끌기·크기·저장)을 얹는다.
const {
  inventory, placements, sprites, equippedCount, needsFaceTracking,
  loading, saving, dirty, error,
  load, setEquipped, canEquip, move, setScale, save,
  cameraEffect, cameraBackground, setIntensity,
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

/** 효과의 영상 쪽 절반(빛 레이어는 CameraEffectLayer가 맡는다) — 세기 슬라이더의 결과를 여기서 본다. */
const camFilterStyle = computed(() =>
  cameraEffect.value
    ? { filter: videoFilter(cameraEffect.value.kind, cameraEffect.value.intensity) }
    : undefined,
)

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

// 가면(FACE 앵커)과 어두운 배경 효과는 저장된 좌표가 아니라 얼굴을 따라간다.
// 그런 아이템을 장착했고 카메라가 켜져 있을 때만 검출기를 돌린다 — 그 외에는 GPU를 물지 않는다.
const face = useFaceAnchor(
  () => videoEl.value,
  () => camera.isOn.value && needsFaceTracking.value,
)

// ── 편집 ────────────────────────────────────────────────
// 크기·삭제는 미리보기의 선택 상자 핸들로 한다(별도 슬라이더 없음).
const selectedId = ref<number | null>(null)
/** 미리보기 프레임의 실제 픽셀 — 오버레이가 크기 상한(원본 이상 확대 금지)을 계산하는 데 쓴다. */
const framePixels = computed(() => ({ w: frameW.value, h: frameH.value }))

/** 선택 상자의 ✕ — 장착 해제와 같다(해제하면 배치에서도 빠진다). */
async function removeSticker(itemId: number) {
  if (!(await setEquipped(itemId, false))) {
    flash(error.value ?? '해제하지 못했어요')
    return
  }
  if (selectedId.value === itemId) selectedId.value = null
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

const nameOf = (itemId: number) =>
  inventory.value.find((i) => i.itemId === itemId)?.name ?? String(itemId)

async function saveDecoration() {
  flash((await save()) ? '화면 꾸미기를 저장했어요' : (error.value ?? '저장하지 못했어요'))
}
</script>

<template>
  <AppPage class="inventory-page" title="내 아바타" title-style="none" max-width="980px">
    <section class="inventory-titlebar">
      <div>
        <p>MY MOTION KIT</p>
        <h1>내 아바타</h1>
        <span>아이템을 장착하고 나만의 화면을 꾸며봐요.</span>
      </div>
    </section>

    <p v-if="loadError" class="load-error">
      <span>{{ loadError }}</span>
      <PixelButton @click="reload">다시 시도</PixelButton>
    </p>

    <div class="grid">
      <PixelCard class="preview-card" title="화면 꾸미기">
        <template #head>
          <PixelButton class="save-decoration" variant="primary" :disabled="saving || !!loadError" @click="saveDecoration">
            {{ saving ? '저장 중…' : dirty ? '꾸미기 저장 *' : '꾸미기 저장' }}
          </PixelButton>
        </template>
        <div class="preview">
          <div class="preview-heading">
            <span>CAMERA PREVIEW</span>
            <b :class="{ ready: camera.isOn.value }">{{ camera.isOn.value ? '카메라 연결됨' : '카메라 OFF' }}</b>
          </div>
          <!-- 게임룸 셀프 뷰와 같은 거울(scaleX(-1)) 방향 — 상대 타일(ParticipantTile)도 발행자
               기준 거울로 뒤집어 보여 주므로, 여기서 거울로 자리를 잡아야 모든 화면과 일치한다.
               스티커 좌표는 StickerOverlay가 mirrored로 되돌려 저장값 기준을 유지한다. -->
          <div class="cam" :style="{ aspectRatio: String(aspect) }">
            <video
              v-show="camera.isOn.value"
              ref="videoEl"
              autoplay
              playsinline
              muted
              :style="camFilterStyle"
              @loadedmetadata="onVideoMeta"
            />
            <!-- 슬라이더로 세기를 맞추려면 결과가 여기 보여야 한다 -->
            <CameraEffectLayer
              v-if="camera.isOn.value && cameraEffect && hasGlowLayer(cameraEffect.kind)"
              :kind="cameraEffect.kind"
              :intensity="cameraEffect.intensity"
            />
            <!-- 배경은 효과 위에. .cam 박스가 영상 비율로 맞춰져 있어(aspectRatio) 박스가 곧
                 프레임이다 — 그래서 아래 StickerOverlay처럼 frame-aspect를 넘기지 않는다. -->
            <CameraEffectLayer
              v-if="camera.isOn.value && cameraBackground"
              :kind="cameraBackground.kind"
              :intensity="cameraBackground.intensity"
              :face="face.anchor.value"
              mirrored
            />
            <div v-if="!camera.isOn.value" class="cam-placeholder">
              <img src="/assets/intro/person.png" alt="" />
              <PixelButton @click="startCamera">카메라 연결</PixelButton>
            </div>
            <StickerOverlay
              :sprites="sprites"
              editable
              mirrored
              :selected-id="selectedId"
              :frame-pixels="framePixels"
              :face="face.anchor.value"
              @move="move"
              @scale="setScale"
              @remove="removeSticker"
              @select="selectedId = $event"
            />
          </div>

          <div class="equipped">
            <template v-for="p in placements" :key="p.itemId">
              <!-- 가면은 얼굴이 자리를 정하므로 고를 게 없다 — 버튼이 아니라 표시만 한다 -->
              <span v-if="p.anchor === 'FACE'" class="badge tracked">
                {{ nameOf(p.itemId) }} · 얼굴
              </span>
              <button
                v-else
                class="badge"
                :class="{ on: selectedId === p.itemId }"
                @click="selectedId = p.itemId"
              >
                {{ nameOf(p.itemId) }}
              </button>
            </template>
            <span v-if="placements.length === 0" class="empty">장착된 아이템이 없어요</span>
          </div>

          <!-- 효과는 끌 손잡이가 없다 — 크기 조절 대신 세기를 여기서 맞춘다 -->
          <EffectIntensitySlider
            v-if="cameraEffect"
            class="fx-row"
            :intensity="cameraEffect.intensity"
            :label="`${EFFECT_LABEL[cameraEffect.kind]} 세기`"
            @change="setIntensity(cameraEffect.itemId, $event)"
          />
          <!-- 배경도 세기를 갖는다 — 효과와 함께 걸릴 수 있어 슬라이더가 둘 다 뜬다 -->
          <EffectIntensitySlider
            v-if="cameraBackground"
            class="fx-row"
            :intensity="cameraBackground.intensity"
            :label="`${EFFECT_LABEL[cameraBackground.kind]} 세기`"
            @change="setIntensity(cameraBackground.itemId, $event)"
          />
        </div>
      </PixelCard>

      <PixelCard class="items-card" title="인벤토리">
        <p v-if="loading" class="empty-inv">불러오는 중…</p>
        <div v-for="g in grouped" :key="g.cat" class="cat-group">
          <div class="cat-head">
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
                <span v-else>?</span>
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
/* 문서 스크롤은 살리고 스크롤바만 숨긴다 — 상점·랭킹과 같은 방식. */
:global(html:has(.inventory-page)), :global(body:has(.inventory-page)) { scrollbar-width: none; }
:global(html:has(.inventory-page)::-webkit-scrollbar), :global(body:has(.inventory-page)::-webkit-scrollbar) { display: none; }
.grid { display: grid; grid-template-columns: 340px 1fr; gap: 18px; }
@media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }

.load-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 14px; padding: 11px 14px; border: 2px solid var(--c-ink); border-radius: 12px; background: #ffe9e4; font-size: 11px; }

.preview { text-align: center; }
.cam { position: relative; overflow: hidden; border: var(--border); border-radius: var(--radius-md); background: linear-gradient(135deg, #dff3ee, #fff0c4); }
/* 박스 비율은 onVideoMeta가 영상에 맞춰 두지만, 비율이 확정되기 전(또는 카메라가 요청과 다른
   해상도를 준 순간)에는 어긋난다 — 그때 얼굴이 잘리지 않게 contain으로 두고 남는 자리는 회색 여백. */
.cam video { width: 100%; height: 100%; object-fit: contain; background: var(--c-letterbox); display: block; transform: scaleX(-1); }
.cam-placeholder { position: absolute; inset: 0; display: grid; place-items: center; align-content: center; gap: 8px; }
.cam-placeholder img { width: 55%; opacity: 0.5; }
.hint { margin: 10px 0 0; font-size: 9px; color: var(--c-muted); line-height: 1.6; }




.equipped { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 12px; }
.badge { font-size: 9px; padding: 5px 8px; border: 2px solid var(--c-ink); border-radius: 999px; background: var(--c-mint-soft); }
.badge.on { background: var(--c-yellow); font-weight: 700; }
/* 얼굴 추적 배지는 누를 수 없다는 게 보여야 한다 */
.badge.tracked { background: var(--c-peach); color: var(--c-muted); }
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

/* Lobby-inspired workshop board */
/* 벽지는 공통 유틸(px-*-bg)이 그린다 — background 축약형으로 덮으면 도트까지 지워진다 */
.inventory-page :deep(.app-page) { padding-top: 34px; }
.inventory-page :deep(.body) { max-width: 980px; }
.inventory-titlebar { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin: 0 auto 18px; padding: 0 6px; }
.inventory-titlebar p { margin: 0 0 8px; color: #a8704f; font-size: 9px; letter-spacing: 1px; }
.inventory-titlebar h1 { margin: 0; color: #4b3429; font-family: var(--font-pixel); font-size: 22px; font-weight: 400; }
.inventory-titlebar span { display: block; margin-top: 9px; color: #856957; font-size: 10px; }
.grid { grid-template-columns: 520px minmax(0, 1fr); gap: 20px; align-items: start; }
.preview-card, .items-card { border: 3px solid #9a6b4f; border-radius: 13px; background: #fffaf0; box-shadow: 5px 5px 0 #d5b28c; }
.preview-card :deep(.card-head), .items-card :deep(.card-head) { padding-bottom: 11px; border-bottom: 2px solid #ead5b8; }.preview-card :deep(.card-head) { justify-content: space-between; }.save-decoration { min-width: 92px; border: 2px solid #9a6b4f; border-radius: 6px; box-shadow: 2px 2px 0 #bd916e; font-size: 9px; }
.preview-card :deep(.card-head h2), .items-card :deep(.card-head h2) { color: #4b3429; font-size: 17px; }
.preview-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 11px; color: #775440; font-size: 9px; letter-spacing: .7px; }.preview-heading b { padding: 5px 8px; border-radius: 5px; background: #f7dfb0; color: #805b42; font-size: 9px; letter-spacing: 0; }.preview-heading b.ready { background: #dcecbf; color: #56743e; }
.cam { border: 3px solid #8d6a54; border-radius: 10px; background: #53423c; box-shadow: none; }.cam::before { content: ''; position: absolute; z-index: 2; inset: 9px; border: 1px solid rgba(255,255,255,.34); border-radius: 4px; pointer-events: none; }.cam-placeholder { z-index: 3; color: #fff9ef; }.cam-placeholder::before { content: ''; display: block; width: 44px; height: 31px; margin: 0 auto 13px; border: 3px solid #f5deb7; border-radius: 5px; box-shadow: 15px 7px 0 -5px #53423c, 15px 7px 0 -2px #f5deb7; }.cam-placeholder img { display: none; }
.cam-placeholder :deep(.px-btn) { border: 2px solid #9a6b4f; border-radius: 6px; background: #f7df9e !important; color: #51382c !important; box-shadow: 2px 2px 0 #bd916e; }.item :deep(.px-btn) { border: 2px solid #9a6b4f; border-radius: 6px; box-shadow: 2px 2px 0 #bd916e; }
.hint, .cat-note, .empty-inv { color: #967a66; }.badge { border-color: #bc8c6a; border-radius: 6px; background: #fff6de; color: #74533f; }.badge.on { border-color: #8c6048; background: #f3cf7a; color: #4b3429; }
.cat-head { border-bottom-color: #e2c7a5; }.cat-label, .name { color: #594031; }.cat-limit { color: #8e715e; }.cat-count { border-color: #bc8c6a; border-radius: 5px; background: #f3cf7a; }
.item { border-color: #c79b77; border-radius: 9px; background: #fffdf6; box-shadow: 3px 3px 0 #dfc09a; }.item.on { border-color: #8d6048; background: #fff2c9; box-shadow: 3px 3px 0 #bd916e; }.thumb { height: 78px; border: 2px solid #ead5b8; border-radius: 7px; background: linear-gradient(135deg, #d6eef1, #fff0bf); color: #795340; font-family: var(--font-pixel); font-size: 18px; }
@media (max-width: 820px) { .grid { grid-template-columns: 1fr; }.inventory-titlebar { align-items: flex-start; flex-direction: column; }.items { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
