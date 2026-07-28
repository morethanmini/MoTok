<script setup lang="ts">
/**
 * 영상 위에 스티커를 겹쳐 보여 주는 레이어(DOM). 캔버스 합성(sticker.ts drawSprites)과 같은
 * 좌표 규칙을 쓰므로 여기서 놓은 자리가 상대에게 보이는 자리와 같다.
 *
 * 두 곳에서 쓴다.
 *  - 인벤토리 편집기: editable=true — 끌어서 위치를 정한다.
 *  - 내 타일 미리보기: 발행되는 트랙은 이미 합성돼 있지만 내 화면의 <video>는 원본이라,
 *    내가 보는 화면에도 같은 스티커를 얹어 준다. 이때 영상이 좌우 반전(scaleX(-1))이면 mirrored=true.
 *
 * 부모는 position:relative + 영상 프레임과 같은 비율의 박스여야 한다(좌표가 프레임 기준이라).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { clamp01, getLoadedImage, spriteWidth, type StickerSprite } from './sticker'

const props = withDefaults(
  defineProps<{
    sprites: StickerSprite[]
    /** 좌우 반전된 영상 위에 얹는지 (자기 미리보기) */
    mirrored?: boolean
    /** 끌어서 위치 변경 허용 */
    editable?: boolean
    selectedId?: number | null
    /**
     * 영상 비율(가로/세로). 박스와 영상 비율이 다를 때 실제 영상이 그려진 영역을 계산하는 데 쓴다.
     * 박스가 곧 프레임이면(편집기처럼 비율을 맞춰 둔 경우) 생략한다.
     */
    frameAspect?: number | null
    /** 영상의 object-fit — 프레임 사각형이 박스 안(contain)인지 밖(cover)인지 결정한다. */
    fit?: 'contain' | 'cover'
  }>(),
  { mirrored: false, editable: false, selectedId: null, frameAspect: null, fit: 'contain' },
)

const emit = defineEmits<{ move: [itemId: number, x: number, y: number]; select: [itemId: number] }>()

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

function styleOf(sprite: StickerSprite) {
  const f = frame.value
  // loadedTick을 읽어 이미지 로드 완료 시 다시 계산되게 한다 — 원본 크기를 알기 전에는
  // 상한을 못 걸어 잠깐 크게 그려지기 때문이다.
  void loadedTick.value
  const w = spriteWidth(f.w, f.h, sprite.scale, getLoadedImage(sprite.imageUrl)?.naturalWidth)
  const nx = props.mirrored ? 1 - clamp01(sprite.x) : clamp01(sprite.x)
  return {
    width: `${w}px`,
    left: `${f.x + nx * f.w}px`,
    top: `${f.y + clamp01(sprite.y) * f.h}px`,
  }
}

/** 포인터 위치 → 정규화 좌표(반전 화면이면 x를 되돌려 저장값 기준으로 바꾼다). */
function toNormalized(e: PointerEvent) {
  const rect = box.value?.getBoundingClientRect()
  const f = frame.value
  if (!rect || !f.w || !f.h) return null
  const x = clamp01((e.clientX - rect.left - f.x) / f.w)
  const y = clamp01((e.clientY - rect.top - f.y) / f.h)
  return { x: props.mirrored ? 1 - x : x, y }
}

/** 이미지 로드 완료를 알리는 신호 — 원본 크기가 확정돼야 상한(원본보다 크게 안 그림)을 걸 수 있다. */
const loadedTick = ref(0)

let dragging: number | null = null

function onPointerDown(e: PointerEvent, sprite: StickerSprite) {
  if (!props.editable) return
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
</script>

<template>
  <div ref="box" class="overlay" :class="{ editable }">
    <img
      v-for="sprite in sprites"
      :key="sprite.itemId"
      class="sticker"
      :class="{ on: editable && selectedId === sprite.itemId }"
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
  </div>
</template>

<style scoped>
/* cover로 잘려 나가는 영역의 스티커는 실제 송출 화면에서도 안 보이므로 여기서도 자른다. */
.overlay { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.overlay.editable .sticker { pointer-events: auto; cursor: grab; }
.overlay.editable .sticker:active { cursor: grabbing; }
/* left·top은 스티커 중심이라 절반만큼 되돌린다 */
.sticker { position: absolute; transform: translate(-50%, -50%); user-select: none; }
.sticker.on { outline: 2px dashed var(--c-ink); outline-offset: 3px; }
</style>
