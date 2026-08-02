<script setup lang="ts">
/** 7장 — 구멍 밖으로 삐져나온 곳은 빨개지고, 벽에 걸려 밀려난다. */
import { AVATAR, BG, FAIL, POSE_MISS, POSE_TEAPOT, RIM, SLAB, SLAB_EDGE } from './art'
import BfFigure from './BfFigure.vue'
import BfStage from './BfStage.vue'

const CENTER = { x: 160, y: 78 }
const SCALE = 0.86
</script>

<template>
  <BfStage>
    <rect
      x="46"
      y="16"
      width="228"
      height="162"
      rx="6"
      :fill="SLAB"
      :stroke="SLAB_EDGE"
      stroke-width="3"
    />
    <!-- 구멍은 아까 그 포즈 그대로 -->
    <BfFigure
      :x="CENTER.x"
      :y="CENTER.y"
      :pose="POSE_TEAPOT"
      :scale="SCALE"
      :color="RIM"
      :bloat="16"
    />
    <BfFigure
      :x="CENTER.x"
      :y="CENTER.y"
      :pose="POSE_TEAPOT"
      :scale="SCALE"
      :color="BG"
      :bloat="10"
    />
    <!-- 그런데 내 포즈는 다르다 — 팔이 구멍 밖으로 나갔다 -->
    <BfFigure
      :x="CENTER.x"
      :y="CENTER.y"
      :pose="POSE_MISS"
      :scale="SCALE"
      :color="AVATAR"
      :overflow-color="FAIL"
      overflow-arm="L"
    />

    <!-- 삐져나온 그 손을 짚어 준다 -->
    <g fill="none" :stroke="FAIL" stroke-width="3.5" stroke-linecap="round">
      <circle cx="126" cy="42" r="22" stroke-dasharray="5 6" />
    </g>

    <text
      class="bf-grade"
      x="160"
      y="196"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="FAIL"
    >
      걸렸다!
    </text>
  </BfStage>
</template>

<style scoped>
.bf-grade {
  font-family: var(--font-pixel), sans-serif;
  font-size: 22px;
}
</style>
