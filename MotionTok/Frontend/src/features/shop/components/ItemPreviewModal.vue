<script setup lang="ts">
/**
 * 상점 아이템 미리보기 — 사기 전에 내 카메라에 걸어 본다.
 *
 * <b>내 꾸미기 설정을 건드리지 않는다.</b> 보유하지도 않은 아이템이라 저장할 수도 없고, 저장했다면
 * 창을 닫는 순간 남의 화면에도 그게 걸린다. 배치·세기는 이 창 안에서만 사는 값이다.
 *
 * <b>이 아이템 하나만 건다.</b> 지금 장착 중인 것까지 함께 그리면 무엇이 이 아이템의 몫인지
 * 알 수 없어 "사면 어떻게 되는지"를 보여 준다는 목적이 사라진다.
 *
 * 카메라는 이 창에서만 켠다. 상점을 보는 내내 카메라 표시등이 켜져 있으면 놀란다.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Item } from '@/api'
import { useCamera } from '@/composables/useCamera'
import { useFaceAnchor } from '@/composables/useFaceAnchor'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import StickerOverlay from '@/features/decor/StickerOverlay.vue'
import CameraEffectLayer from '@/features/decor/CameraEffectLayer.vue'
import EffectIntensitySlider from '@/features/decor/EffectIntensitySlider.vue'
import {
  DEFAULT_INTENSITY,
  EFFECT_LABEL,
  backgroundKindOf,
  effectKindOf,
  hasGlowLayer,
  needsFaceAnchor,
  videoFilter,
} from '@/features/decor/cameraEffect'
import {
  DEFAULT_PLACEMENT,
  clamp01,
  clampScale,
  preloadImage,
  scaleLimits,
} from '@/features/decor/sticker'

const props = defineProps<{ item: Item }>()
const emit = defineEmits<{ close: []; buy: [] }>()

const camera = useCamera()
const videoEl = ref<HTMLVideoElement>()
watch(camera.stream, (s) => {
  if (videoEl.value) videoEl.value.srcObject = s
})
/** 스티커 원본 가로 픽셀 — 확대 상한의 근거다(원본보다 크게 늘리면 뭉개진다). */
const naturalWidth = ref(0)

onMounted(() => {
  camera.start({ video: { width: 640, height: 480 } })
  const url = props.item.imageUrl
  if (!url) return
  // 오버레이가 보는 캐시를 채운다. 이게 없으면 naturalWidth를 몰라 상한이 아예 풀린다.
  preloadImage(url)
  const img = new Image()
  img.onload = () => {
    naturalWidth.value = img.naturalWidth
    fitScaleToLimit()
  }
  img.src = url
})
// 창을 닫으면 카메라도 끈다 — 미리보기 하나 때문에 상점 내내 켜져 있을 이유가 없다.
onBeforeUnmount(() => camera.stop())

const frameW = ref(640)
const frameH = ref(480)
const framePixels = computed(() => ({ w: frameW.value, h: frameH.value }))
const aspect = computed(() => frameW.value / frameH.value)
function onVideoMeta() {
  const el = videoEl.value
  if (!el?.videoWidth || !el.videoHeight) return
  frameW.value = el.videoWidth
  frameH.value = el.videoHeight
  // 프레임이 확정되면 상한도 달라진다 — 기본 크기가 그 상한을 넘고 있으면 지금 맞춘다.
  fitScaleToLimit()
}

/**
 * 기본 크기를 상한 안으로 들여놓는다.
 *
 * 크기 핸들은 `scaleLimits`(프레임 픽셀 기준)로 자르는데 기본값 0.22는 그 상한을 넘을 수 있다.
 * 그대로 두면 처음엔 크게 그려졌다가 손잡이를 잡는 순간 확 줄어든다 — 만지지도 않았는데
 * 크기가 변한 것처럼 보인다.
 */
function fitScaleToLimit() {
  if (!naturalWidth.value) return
  const { max } = scaleLimits(frameW.value, frameH.value, naturalWidth.value)
  if (placement.value.scale > max) placement.value = { ...placement.value, scale: max }
}

/** 이 아이템이 프레임 효과라면 그 종류. 스티커·미구현 분류면 null. */
const effectKind = computed(() =>
  props.item.category === 'EFFECT' ? effectKindOf(props.item.imageUrl) : null,
)
/** 이 아이템이 배경이라면 그 종류. 효과와 나눠 두는 이유는 cameraEffect의 BackgroundKind 주석. */
const backgroundKind = computed(() =>
  props.item.category === 'BACKGROUND' ? backgroundKindOf(props.item.imageUrl) : null,
)
const isSticker = computed(() => props.item.category === 'STICKER' && !!props.item.imageUrl)
/** 가면은 좌표를 조절하지 않는다 — 얼굴이 자리와 크기를 정한다. */
const isMask = computed(() => props.item.category === 'MASK' && !!props.item.imageUrl)

/** 얼굴을 찾아야 미리보기가 성립하는 아이템 — 가면과 어두운 배경. */
const needsFace = computed(
  () => isMask.value || (backgroundKind.value ? needsFaceAnchor(backgroundKind.value) : false),
)

/** 세기 슬라이더가 붙는 아이템 — 효과든 배경이든 세기를 갖는다. 한 창에 하나만 뜬다. */
const adjustableKind = computed(() => effectKind.value ?? backgroundKind.value)

// 사기 전에도 얼굴에 얹어 봐야 한다 — 어떻게 씌워지는지가 이 아이템의 전부다.
const face = useFaceAnchor(
  () => videoEl.value,
  () => camera.isOn.value && needsFace.value,
)

// ── 이 창에서만 사는 조절값 ──────────────────────────────
const intensity = ref(DEFAULT_INTENSITY)
// DEFAULT_PLACEMENT은 as const라 그대로 쓰면 리터럴 타입으로 굳는다 — 조절할 값이므로 넓혀 둔다.
const placement = ref<{ x: number; y: number; scale: number }>({ ...DEFAULT_PLACEMENT })

/**
 * 한 장짜리 목록 — StickerOverlay가 배열을 받으므로 맞춰 준다.
 * 가면은 FACE로 넣어 좌표를 오버레이가 얼굴에서 잡게 한다(placement는 쓰이지 않는다).
 */
const sprites = computed(() => {
  const imageUrl = props.item.imageUrl
  if (!imageUrl) return []
  if (isMask.value) {
    return [{ itemId: props.item.id, anchor: 'FACE' as const, x: 0, y: 0, scale: 0, imageUrl }]
  }
  return isSticker.value
    ? [{ itemId: props.item.id, anchor: 'FIXED' as const, ...placement.value, imageUrl }]
    : []
})

const filterStyle = computed(() =>
  effectKind.value ? { filter: videoFilter(effectKind.value, intensity.value) } : undefined,
)

function onMove(_itemId: number, x: number, y: number) {
  placement.value = { ...placement.value, x: clamp01(x), y: clamp01(y) }
}
function onScale(_itemId: number, scale: number) {
  placement.value = { ...placement.value, scale: clampScale(scale) }
}

/** 그려서 보여 줄 수 있는 아이템인지 — 렌더러가 없는 분류는 미리보기를 열지 않는다. */
const previewable = computed(
  () => isSticker.value || isMask.value || !!effectKind.value || !!backgroundKind.value,
)
</script>

<template>
  <PixelModal variant="lobby" @close="emit('close')">
    <section class="preview" aria-labelledby="item-preview-title">
      <header>
        <span class="kicker">TRY BEFORE BUY</span>
        <h3 id="item-preview-title">{{ item.name }}</h3>
        <p>지금 내 카메라에 이 아이템만 걸어 본 모습이에요. 저장되지 않아요.</p>
      </header>

      <!-- 좌우 반전(거울) — 자기 얼굴을 보며 맞추는 화면이라 뒤집어 보여 준다.
           스티커 좌표는 오버레이가 mirrored로 따라간다. -->
      <div class="stage" :style="{ aspectRatio: String(aspect) }">
        <video
          v-show="camera.isOn.value"
          ref="videoEl"
          autoplay
          playsinline
          muted
          :style="filterStyle"
          @loadedmetadata="onVideoMeta"
        />
        <CameraEffectLayer
          v-if="camera.isOn.value && effectKind && hasGlowLayer(effectKind)"
          :kind="effectKind"
          :intensity="intensity"
        />
        <CameraEffectLayer
          v-if="camera.isOn.value && backgroundKind"
          :kind="backgroundKind"
          :intensity="intensity"
          :face="face.anchor.value"
          mirrored
          fit="cover"
          :frame-aspect="aspect"
        />
        <StickerOverlay
          v-if="camera.isOn.value && sprites.length"
          :sprites="sprites"
          mirrored
          editable
          fit="cover"
          :frame-aspect="aspect"
          :frame-pixels="framePixels"
          :selected-id="item.id"
          :removable="false"
          :face="face.anchor.value"
          @move="onMove"
          @scale="onScale"
        />

        <!-- 가면·어두운 배경은 얼굴을 찾아야 보인다 — 아무것도 안 뜨면 아이템이 고장 난 줄 안다 -->
        <p v-if="camera.isOn.value && needsFace && !face.anchor.value" class="stage-hint">
          얼굴이 보이게 화면 가운데로 와 주세요
        </p>

        <div v-if="!camera.isOn.value" class="stage-empty">
          <p v-if="camera.error.value">{{ camera.error.value }}</p>
          <p v-else>카메라를 준비하고 있어요…</p>
        </div>
      </div>

      <!-- 조절: 효과·배경은 세기, 스티커는 화면에서 끌어 옮기고 핸들로 크기를 바꾼다 -->
      <EffectIntensitySlider
        v-if="adjustableKind"
        class="preview-slider"
        :intensity="intensity"
        :label="`${EFFECT_LABEL[adjustableKind]} 세기`"
        @change="intensity = $event"
      />
      <p v-else-if="isSticker" class="hint">끌어서 옮기고, 모서리 손잡이로 크기를 바꿔 보세요.</p>
      <p v-else-if="!previewable" class="hint">이 분류는 아직 미리보기를 지원하지 않아요.</p>

      <footer class="actions">
        <PixelButton block @click="emit('close')">닫기</PixelButton>
        <PixelButton v-if="!item.owned" variant="yellow" block @click="emit('buy')">구매</PixelButton>
      </footer>
    </section>
  </PixelModal>
</template>

<style scoped>
.preview { display: grid; gap: 12px; }
header { text-align: center; }
.kicker { display: block; color: #a87069; font-size: 9px; letter-spacing: 1px; }
h3 { margin: 5px 0 4px; font-size: 19px; }
header p { margin: 0; color: #897460; font-size: 11px; }

.stage {
  position: relative;
  width: 100%;
  overflow: hidden;
  border: 2px solid #d8bd95;
  border-radius: 10px;
  background: #2b2333;
}
.stage video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* 거울 — 얼굴을 보며 맞추는 화면이라 뒤집는다(스티커는 오버레이가 따로 맞춘다) */
  transform: scaleX(-1);
}
.stage-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  color: #e9dcc8;
  font-size: 11px;
  text-align: center;
}
.stage-empty p { margin: 0; }

/* 얼굴을 찾는 동안 아래쪽에 띄운다 — 가운데는 정작 봐야 할 얼굴 자리다 */
.stage-hint {
  position: absolute;
  right: 8px;
  bottom: 8px;
  left: 8px;
  margin: 0;
  padding: 6px;
  border-radius: 6px;
  background: rgb(0 0 0 / 55%);
  color: #e9dcc8;
  font-size: 10px;
  text-align: center;
}

.preview-slider { padding: 0 2px; }
.hint { margin: 0; color: #897460; font-size: 10px; text-align: center; }

.actions { display: flex; gap: 9px; }
.actions > * { flex: 1; }
</style>
