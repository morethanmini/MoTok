<script setup lang="ts">
/** 6장 — 몸이 쏙 들어가면 벽이 부서지며 지나간다. */
import { AVATAR, PERFECT, POSE_TEAPOT, SLAB } from './art'
import BfFigure from './BfFigure.vue'
import BfStage from './BfStage.vue'

/** 부서져 흩어지는 돌 조각. */
const GRAINS = [
  { x: 62, y: 54, s: 9, r: 18 },
  { x: 96, y: 34, s: 6, r: -12 },
  { x: 238, y: 48, s: 10, r: 24 },
  { x: 268, y: 88, s: 7, r: -8 },
  { x: 48, y: 108, s: 7, r: 30 },
  { x: 262, y: 140, s: 8, r: -20 },
  { x: 84, y: 148, s: 6, r: 14 },
]
</script>

<template>
  <BfStage>
    <g :fill="SLAB" stroke="#7d7059" stroke-width="2">
      <rect
        v-for="(g, i) in GRAINS"
        :key="i"
        :x="g.x"
        :y="g.y"
        :width="g.s * 2"
        :height="g.s * 2"
        rx="2"
        :transform="`rotate(${g.r} ${g.x + g.s} ${g.y + g.s})`"
        :opacity="0.85 - i * 0.06"
      />
    </g>

    <BfFigure :x="160" :y="76" :pose="POSE_TEAPOT" :scale="0.92" :color="AVATAR" />

    <text
      class="bf-grade"
      x="160"
      y="192"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="PERFECT"
    >
      PERFECT
    </text>
  </BfStage>
</template>

<style scoped>
.bf-grade {
  font-family: var(--font-pixel), sans-serif;
  font-size: 26px;
}
</style>
