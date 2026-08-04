<script setup lang="ts">
/**
 * 영상 위에 스티커를 겹쳐 보여 주는 레이어(DOM). 편집기·내 타일·상대 타일이 모두 이걸 쓰므로
 * 여기서 놓은 자리가 상대에게 보이는 자리와 같다.
 *
 *  - 편집기(인벤토리·장치 설정): editable=true — 끌어서 옮기고, 핸들로 삭제·크기 조절.
 *  - 타일: 좌우 반전(scaleX(-1))된 영상 위라면 mirrored=true.
 *
 * 부모는 position:relative + 영상 프레임과 같은 비율의 박스여야 한다(좌표가 프레임 기준이라).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  clamp01,
  getLoadedImage,
  scaleLimits,
  spriteWidth,
  type StickerSprite,
} from './sticker'
import type { FaceAnchor } from './faceAnchor'

const props = withDefaults(
  defineProps<{
    sprites: StickerSprite[]
    /** 좌우 반전된 영상 위에 얹는지 (자기 미리보기) */
    mirrored?: boolean
    /** 끌어서 위치 변경·핸들 조작 허용 */
    editable?: boolean
    /**
     * 삭제(✕) 손잡이를 보일지. 상점 미리보기처럼 <b>지울 대상이 없는</b> 화면에서는 끈다 —
     * 눌러도 아무 일이 없는 버튼이 붙어 있으면 고장으로 읽힌다.
     */
    removable?: boolean
    selectedId?: number | null
    /**
     * 영상 비율(가로/세로). 박스와 영상 비율이 다를 때 실제 영상이 그려진 영역을 계산하는 데 쓴다.
     * 박스가 곧 프레임이면(편집기처럼 비율을 맞춰 둔 경우) 생략한다.
     */
    frameAspect?: number | null
    /** 영상의 object-fit — 프레임 사각형이 박스 안(contain)인지 밖(cover)인지 결정한다. */
    fit?: 'contain' | 'cover'
    /**
     * 실제 영상 픽셀 크기. 크기 상한(원본 이미지보다 크게 안 그림)이 화면 표시 크기가 아니라
     * 송출 프레임 기준이라 필요하다. 없으면 상한 없이 0~1로만 자른다.
     */
    framePixels?: { w: number; h: number } | null
    /**
     * 지금 추적 중인 얼굴(useFaceAnchor). 앵커가 FACE인 스프라이트(가면)는 저장된 좌표가 아니라
     * 이 값으로 매 프레임 자리를 잡는다. null이면 그 스프라이트를 아예 그리지 않는다 —
     * 얼굴을 못 찾았는데 아무 데나 얹으면 그게 더 고장 나 보인다.
     */
    face?: FaceAnchor | null
  }>(),
  {
    mirrored: false,
    editable: false,
    removable: true,
    selectedId: null,
    frameAspect: null,
    fit: 'contain',
    framePixels: null,
    face: null,
  },
)

const emit = defineEmits<{
  move: [itemId: number, x: number, y: number]
  scale: [itemId: number, scale: number]
  remove: [itemId: number]
  select: [itemId: number]
}>()

// 스티커 크기는 "프레임 짧은 변 × scale"이라 컨테이너 실제 px가 필요하다.
const box = ref<HTMLElement>()
const boxW = ref(0)
const boxH = ref(0)
let observer: ResizeObserver | undefined

onMounted(() => {
  if (!box.value) return
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return
    boxW.value = entry.contentRect.width
    boxH.value = entry.contentRect.height
  })
  observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())

/**
 * 영상 프레임이 실제로 놓이는 사각형. contain이면 박스 안에 들어가고(여백 생김),
 * cover면 박스 밖으로 넘친다(잘림) — 둘 다 중앙 정렬이라 계산은 분기 방향만 다르다.
 * frameAspect가 없으면 박스가 곧 프레임이다.
 */
const frame = computed(() => {
  const bw = boxW.value
  const bh = boxH.value
  const aspect = props.frameAspect
  if (!aspect || !bw || !bh) return { x: 0, y: 0, w: bw, h: bh }

  const boxIsWider = bw / bh > aspect
  const fitToHeight = props.fit === 'contain' ? boxIsWider : !boxIsWider
  if (fitToHeight) {
    const w = bh * aspect
    return { x: (bw - w) / 2, y: 0, w, h: bh }
  }
  const h = bw / aspect
  return { x: 0, y: (bh - h) / 2, w: bw, h }
})

/** 이미지 로드 완료를 알리는 신호 — 원본 크기가 확정돼야 상한(원본보다 크게 안 그림)을 걸 수 있다. */
const loadedTick = ref(0)

/** 이 스프라이트를 얼굴 추적으로 얹어야 하는지 — 맞으면 지금 추적된 얼굴을 돌려준다. */
function trackedFace(sprite: StickerSprite): FaceAnchor | null {
  return sprite.anchor === 'FACE' ? props.face : null
}

/** 얼굴을 아직 못 찾은 가면은 건너뛴다(저장 좌표에 얹지 않는다). */
const drawn = computed(() => props.sprites.filter((s) => s.anchor !== 'FACE' || !!props.face))

/**
 * 화면에 그려질 스티커 상자(중심 좌표·크기·기울기, px). 스티커와 선택 테두리가 같은 값을 쓴다.
 *
 * 얼굴 앵커는 저장된 x·y·scale을 쓰지 않고 매 프레임 얼굴에서 다시 계산한다. 원본 크기 상한
 * (spriteWidth)도 걸지 않는다 — 얼굴보다 작게 그리면 눈 구멍이 어긋나므로, 여기서는 선명함보다
 * <b>정렬</b>이 우선이다.
 */
function rectOf(sprite: StickerSprite) {
  const f = frame.value
  void loadedTick.value
  const img = getLoadedImage(sprite.imageUrl)
  const face = trackedFace(sprite)
  const place = face ?? sprite
  const w = face
    ? Math.min(f.w, f.h) * Math.max(face.scale, 0)
    : spriteWidth(f.w, f.h, sprite.scale, img?.naturalWidth)
  const h = img ? w * (img.naturalHeight / img.naturalWidth) : w
  const nx = props.mirrored ? 1 - clamp01(place.x) : clamp01(place.x)
  // 좌우 반전된 영상 위에서는 기울기도 뒤집힌다 — 안 뒤집으면 고개를 기울일 때 반대로 돈다.
  const rotation = face ? (props.mirrored ? -face.rotation : face.rotation) : 0
  return { cx: f.x + nx * f.w, cy: f.y + clamp01(place.y) * f.h, w, h, rotation }
}

/** left·top이 중심이라 절반만큼 되돌린 뒤 기울인다(순서를 바꾸면 회전 중심이 어긋난다). */
function styleOf(sprite: StickerSprite) {
  const r = rectOf(sprite)
  return {
    width: `${r.w}px`,
    left: `${r.cx}px`,
    top: `${r.cy}px`,
    transform: `translate(-50%, -50%) rotate(${r.rotation}rad)`,
  }
}

/** 선택 테두리 — 스티커보다 살짝 크게 둘러 핸들이 그림을 덜 가리게 한다. */
function frameStyleOf(sprite: StickerSprite) {
  const r = rectOf(sprite)
  return { width: `${r.w}px`, height: `${r.h}px`, left: `${r.cx}px`, top: `${r.cy}px` }
}

/**
 * 편집 대상 — 얼굴 앵커(가면)는 제외한다. 자리와 크기를 얼굴이 정하므로 끌어 옮길 것도,
 * 크기를 조절할 것도 없다(빼려면 인벤토리에서 장착을 해제한다).
 */
const selectedSprite = computed(
  () => drawn.value.find((s) => s.itemId === props.selectedId && !trackedFace(s)) ?? null,
)

/** 포인터 위치 → 정규화 좌표(반전 화면이면 x를 되돌려 저장값 기준으로 바꾼다). */
function toNormalized(e: PointerEvent) {
  const rect = box.value?.getBoundingClientRect()
  const f = frame.value
  if (!rect || !f.w || !f.h) return null
  const x = clamp01((e.clientX - rect.left - f.x) / f.w)
  const y = clamp01((e.clientY - rect.top - f.y) / f.h)
  return { x: props.mirrored ? 1 - x : x, y }
}

// ── 드래그(이동) ────────────────────────────────────────
let dragging: number | null = null

function onPointerDown(e: PointerEvent, sprite: StickerSprite) {
  if (!props.editable || trackedFace(sprite)) return
  emit('select', sprite.itemId)
  dragging = sprite.itemId
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}

function onPointerMove(e: PointerEvent) {
  if (dragging === null) return
  const pos = toNormalized(e)
  if (pos) emit('move', dragging, pos.x, pos.y)
}

function onPointerUp(e: PointerEvent) {
  if (dragging === null) return
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  dragging = null
}

// ── 크기 핸들 ──────────────────────────────────────────
/**
 * 중심에서 포인터까지의 거리로 크기를 정한다.
 * 잡은 순간의 (거리 : scale) 비를 기억해 두고 그 비율을 유지하는 방식이라,
 * 모서리를 어디서 잡든 스티커가 튀지 않는다.
 */
let resizing: { itemId: number; ratio: number } | null = null

function distanceFromCenter(e: PointerEvent, sprite: StickerSprite): number {
  const rect = box.value?.getBoundingClientRect()
  if (!rect) return 0
  const r = rectOf(sprite)
  const dx = e.clientX - rect.left - r.cx
  const dy = e.clientY - rect.top - r.cy
  return Math.hypot(dx, dy)
}

function onResizeDown(e: PointerEvent, sprite: StickerSprite) {
  const distance = distanceFromCenter(e, sprite)
  if (!distance) return
  resizing = { itemId: sprite.itemId, ratio: sprite.scale / distance }
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
  e.stopPropagation()
}

function onResizeMove(e: PointerEvent) {
  const sprite = selectedSprite.value
  if (!resizing || !sprite) return
  const distance = distanceFromCenter(e, sprite)
  if (!distance) return
  const limits = props.framePixels
    ? scaleLimits(
        props.framePixels.w,
        props.framePixels.h,
        getLoadedImage(sprite.imageUrl)?.naturalWidth ?? 0,
      )
    : { min: 0, max: 1 }
  const next = Math.min(limits.max, Math.max(limits.min, distance * resizing.ratio))
  emit('scale', resizing.itemId, next)
}

function onResizeUp(e: PointerEvent) {
  if (!resizing) return
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  resizing = null
}
</script>

<template>
  <div ref="box" class="overlay" :class="{ editable }">
    <img
      v-for="sprite in drawn"
      :key="sprite.itemId"
      class="sticker"
      :class="{ tracked: !!trackedFace(sprite) }"
      :src="sprite.imageUrl"
      :style="styleOf(sprite)"
      alt=""
      draggable="false"
      @load="loadedTick++"
      @pointerdown="onPointerDown($event, sprite)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />

    <!-- 선택 상자 — 고른 스티커에만. 삭제(✕)와 크기(⤡) 핸들이 모서리에 붙는다. -->
    <div
      v-if="editable && selectedSprite"
      class="select-box"
      :style="frameStyleOf(selectedSprite)"
    >
      <button
        type="button"
        v-if="removable"
        class="handle remove"
        title="삭제"
        aria-label="스티커 삭제"
        @pointerdown.stop
        @click.stop="emit('remove', selectedSprite.itemId)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
      </button>
      <button
        type="button"
        class="handle resize"
        title="크기 조절 — 끌어서 조절"
        aria-label="스티커 크기 조절"
        @pointerdown="onResizeDown($event, selectedSprite)"
        @pointermove="onResizeMove"
        @pointerup="onResizeUp"
        @pointercancel="onResizeUp"
      >
        <!-- 대각선 양방향 화살표 — 모서리를 끌어 키우고 줄인다는 뜻 -->
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4l16 16M4 11V4h7M20 13v7h-7" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* cover로 잘려 나가는 영역의 스티커는 실제 송출 화면에서도 안 보이므로 여기서도 자른다. */
.overlay { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.overlay.editable .sticker { pointer-events: auto; cursor: grab; }
.overlay.editable .sticker:active { cursor: grabbing; }
/* left·top은 스티커 중심이라 절반만큼 되돌린다 */
/* 중심 보정·회전은 styleOf가 인라인 transform으로 한다(여기서 겹쳐 쓰면 인라인이 덮어써 버린다) */
.sticker { position: absolute; user-select: none; }
/* 가면은 얼굴이 자리를 정하므로 끌 수 없다 — 밑에 있는 스티커를 가로막지도 않게 한다 */
.overlay.editable .sticker.tracked { pointer-events: none; }

.select-box {
  position: absolute;
  transform: translate(-50%, -50%);
  border: 2px dashed var(--c-ink, #2b2333);
  border-radius: 4px;
  pointer-events: none;
}
/* 핸들만 눌리게 한다 — 상자 안쪽은 통과시켜야 스티커를 그대로 끌 수 있다. */
.handle {
  position: absolute;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 2px solid var(--c-ink, #2b2333);
  border-radius: 50%;
  background: #fff;
  box-shadow: 2px 2px 0 rgba(43, 35, 51, 0.35);
  pointer-events: auto;
  touch-action: none;
}
/* 아이콘은 프로젝트 픽셀 아이콘과 같은 결로 — 굵은 선 + 각진 끝. */
.handle svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 3.2;
  stroke-linecap: square;
  stroke-linejoin: miter;
}
.handle.remove { top: -12px; right: -12px; color: #d0453f; }
.handle.resize { bottom: -12px; right: -12px; color: var(--c-ink, #2b2333); cursor: nwse-resize; }
</style>
