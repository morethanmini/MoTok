<script setup lang="ts">
/** 5장 — 구멍과 똑같은 포즈를 만든다. 실루엣이 겹치면 맞은 것. */
import { AVATAR, BG, GREAT, POSE_TEAPOT, RIM, SLAB, SLAB_EDGE } from './art'
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
    <!-- 내 아바타가 구멍 안에 쏙 들어가 있다 -->
    <BfFigure :x="CENTER.x" :y="CENTER.y" :pose="POSE_TEAPOT" :scale="SCALE" :color="AVATAR" />

    <!-- 얼마나 맞았는지 -->
    <g>
      <circle
        cx="272"
        cy="196"
        r="19"
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        stroke-width="5"
      />
      <circle
        cx="272"
        cy="196"
        r="19"
        fill="none"
        :stroke="GREAT"
        stroke-width="5"
        stroke-linecap="round"
        stroke-dasharray="107 119"
        transform="rotate(-90 272 196)"
      />
      <text
        class="bf-pct"
        x="272"
        y="197"
        text-anchor="middle"
        dominant-baseline="central"
        :fill="GREAT"
      >
        90
      </text>
    </g>
  </BfStage>
</template>

<style scoped>
.bf-pct {
  font-family: var(--font-pixel), sans-serif;
  font-size: 14px;
}
</style>
