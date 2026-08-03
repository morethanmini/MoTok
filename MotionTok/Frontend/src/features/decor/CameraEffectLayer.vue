<script setup lang="ts">
/**
 * 카메라 영상 위에 겹치는 뽀샤시 레이어.
 *
 * 부모는 `position: relative`인 영상 프레임 박스여야 한다. 영상 자체의 보정(`videoFilter`)은
 * 이 컴포넌트가 아니라 `<video>`에 걸어야 해서 호출부가 담당한다 — 두 개가 한 짝이다.
 *
 * 스티커와 달리 좌표가 없어 프레임을 그대로 덮는다. 그래서 `object-fit`으로 생긴 여백까지
 * 덮이는데, 여백은 검은 배경이라 `screen` 합성에서 아무 변화가 없다(0에 더해도 0).
 */
import { computed } from 'vue'
import { glowStyle } from './cameraEffect'

const props = defineProps<{ intensity: number }>()

const style = computed(() => glowStyle(props.intensity))
</script>

<template>
  <div class="fx-glow" :style="style" aria-hidden="true" />
</template>

<style scoped>
.fx-glow {
  position: absolute;
  inset: 0;
  /* 밝은 쪽으로만 더해 피부는 부드럽게, 눈·입 윤곽은 원본이 남는다 */
  mix-blend-mode: screen;
  /* 스티커·라벨보다 아래 — 효과는 영상에 걸리는 것이고 얹는 물건이 아니다 */
  z-index: 0;
  pointer-events: none;
}
</style>
