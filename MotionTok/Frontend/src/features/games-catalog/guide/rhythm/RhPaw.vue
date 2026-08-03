<script setup lang="ts">
/**
 * 고양이 발바닥 (SVG 조각). 이 게임에서는 <b>음표도 손 커서도</b> 같은 발바닥 모양이라
 * 하나로 그리고 색만 바꾼다 — 실제 화면이 그렇다(note-paw-pink / paw-left-sky).
 *
 * 좌표는 한 변 1인 상자 기준으로 그리고 size로 키운다. 그래야 어느 장에서든 같은 비율이다.
 */
withDefaults(
  defineProps<{
    x: number
    y: number
    /** 발바닥 전체 지름(px). */
    size: number
    fill: string
    edge: string
    /** 가운데에 찍는 글자(L·R). 아무 손이나 되는 음표는 비운다. */
    letter?: string
  }>(),
  { letter: '' },
)

/** 발가락 4개 — 가운데 둘이 조금 더 위로. */
const TOES = [
  { x: -0.33, y: -0.2, rx: 0.145, ry: 0.185, rot: -18 },
  { x: -0.115, y: -0.33, rx: 0.145, ry: 0.195, rot: -6 },
  { x: 0.115, y: -0.33, rx: 0.145, ry: 0.195, rot: 6 },
  { x: 0.33, y: -0.2, rx: 0.145, ry: 0.185, rot: 18 },
]
</script>

<template>
  <g :transform="`translate(${x} ${y}) scale(${size})`">
    <g :fill="fill" :stroke="edge" :stroke-width="2.6 / size">
      <ellipse cx="0" cy="0.21" rx="0.39" ry="0.29" />
      <ellipse
        v-for="(t, i) in TOES"
        :key="i"
        :cx="t.x"
        :cy="t.y"
        :rx="t.rx"
        :ry="t.ry"
        :transform="`rotate(${t.rot} ${t.x} ${t.y})`"
      />
    </g>
    <text
      v-if="letter"
      class="rh-letter"
      x="0"
      y="0.22"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="edge"
      :style="{ fontSize: `${0.34}px` }"
    >
      {{ letter }}
    </text>
  </g>
</template>

<style scoped>
.rh-letter {
  font-family: var(--font-pixel), sans-serif;
  font-weight: 700;
}
</style>
