<script setup lang="ts">
/**
 * 카메라 영상 위에 겹치는 효과 레이어 — 뽀샤시는 빛을 얹고, 어두운 배경은 어둠을 얹는다.
 *
 * 부모는 `position: relative`인 영상 프레임 박스여야 한다. 영상 자체의 보정(`videoFilter`)은
 * 이 컴포넌트가 아니라 `<video>`에 걸어야 해서 호출부가 담당한다 — 두 개가 한 짝이다.
 * (어두운 배경은 그 절반이 `none`이다 — 이유는 cameraEffect의 videoFilter 주석.)
 *
 * <b>뽀샤시는 좌표가 없고, 어두운 배경은 있다.</b> 뽀샤시는 프레임을 그대로 덮는다 —
 * `object-fit`으로 생긴 여백까지 덮이지만 여백은 검은 배경이라 `screen` 합성에서 아무 변화가
 * 없다(0에 더해도 0). 어두운 배경은 구멍을 얼굴에 맞춰야 하므로 스티커와 같은 프레임 기하
 * (frameBox·mirrored)를 받는다 — 가면과 구멍이 같은 자리를 가리켜야 한다.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  glowStyle,
  spotlightHole,
  spotlightStyle,
  type CameraLayerKind,
  type SpotlightHole,
} from './cameraEffect'
import { frameRect } from './frameBox'
import type { FaceAnchor } from './faceAnchor'

const props = withDefaults(
  defineProps<{
    kind: CameraLayerKind
    intensity: number
    /**
     * 지금 추적 중인 얼굴(useFaceAnchor 또는 데이터 채널로 받은 남의 앵커).
     * 어두운 배경에만 쓰인다 — 없으면 효과가 사라진다(cameraEffect의 spotlightStyle 주석).
     */
    face?: FaceAnchor | null
    /** 좌우 반전된 영상 위에 얹는지 (자기 미리보기) */
    mirrored?: boolean
    /** 영상 비율(가로/세로). 박스가 곧 프레임이면 생략한다. */
    frameAspect?: number | null
    /** 영상의 object-fit — `<video>`와 같은 값이어야 구멍이 얼굴에 맞는다. */
    fit?: 'contain' | 'cover'
  }>(),
  { face: null, mirrored: false, frameAspect: null, fit: 'contain' },
)

// 구멍 위치·크기가 "프레임 짧은 변 × scale"이라 컨테이너 실제 px가 필요하다(StickerOverlay와 같다).
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

const frame = computed(() => frameRect(boxW.value, boxH.value, props.frameAspect, props.fit))

const hole = computed(() =>
  props.face ? spotlightHole(props.face, frame.value, props.mirrored) : null,
)

/**
 * 마지막으로 잡은 구멍. 얼굴을 놓치면 <b>이 값을 남겨 둔 채 투명도만 0으로 내린다</b> —
 * 지워 버리면 사라지는 동안 구멍 없는 어둠이 얼굴을 덮어, 페이드아웃이 오히려 깜빡임이 된다.
 */
const lastHole = ref<SpotlightHole | null>(null)
watch(hole, (h) => {
  if (h) lastHole.value = h
})

const isSpotlight = computed(() => props.kind === 'SPOTLIGHT')

const style = computed(() =>
  isSpotlight.value
    ? spotlightStyle(props.intensity, hole.value ?? lastHole.value, hole.value !== null)
    : glowStyle(props.intensity),
)
</script>

<template>
  <div ref="box" class="fx" :class="isSpotlight ? 'fx-spot' : 'fx-glow'" :style="style" aria-hidden="true" />
</template>

<style scoped>
.fx {
  position: absolute;
  inset: 0;
  /* 스티커·라벨보다 아래 — 효과는 영상에 걸리는 것이고 얹는 물건이 아니다 */
  z-index: 0;
  pointer-events: none;
}

/* 밝은 쪽으로만 더해 피부는 부드럽게, 눈·입 윤곽은 원본이 남는다 */
.fx-glow {
  mix-blend-mode: screen;
}

/* 어두운 배경은 어둠을 그대로 겹친다 — screen이면 밝아져 방향이 반대가 된다.
   얼굴을 놓쳤다 다시 찾을 때 뚝뚝 끊기지 않게 투명도만 완만히 오간다. */
.fx-spot {
  transition: opacity 200ms ease-out;
}
</style>
