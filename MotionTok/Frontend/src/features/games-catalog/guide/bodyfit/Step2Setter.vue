<script setup lang="ts">
/** 2장 — 한 친구가 출제자가 되어 포즈를 정한다(👑). */
import { GOLD, MUTED, POSE_TEAPOT, PLAYER } from './art'
import BfFigure from './BfFigure.vue'
import BfStage from './BfStage.vue'

/** 출제 시간은 5초 — 큰 숫자로 세는 그 화면. */
const COUNT = 3
</script>

<template>
  <BfStage>
    <!-- 출제자 -->
    <BfFigure :x="112" :y="92" :pose="POSE_TEAPOT" :scale="0.92" :color="PLAYER" />
    <!-- 왕관 — 뿔 셋에 받침 띠를 둬야 산봉우리로 안 보인다 -->
    <g :fill="GOLD" stroke="#8a6a1e" stroke-width="2.5" stroke-linejoin="round">
      <path d="M 94 42 L 99 24 L 112 34 L 125 24 L 130 42 Z" />
      <rect x="93" y="41" width="38" height="8" rx="3" />
    </g>

    <!-- 남은 시간 -->
    <circle cx="234" cy="98" r="34" fill="none" :stroke="GOLD" stroke-width="5" opacity="0.35" />
    <circle
      cx="234"
      cy="98"
      r="34"
      fill="none"
      :stroke="GOLD"
      stroke-width="5"
      stroke-linecap="round"
      stroke-dasharray="150 214"
      transform="rotate(-90 234 98)"
    />
    <text
      class="bf-count"
      x="234"
      y="99"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="GOLD"
    >
      {{ COUNT }}
    </text>
    <text
      class="bf-cap"
      x="234"
      y="150"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="MUTED"
    >
      포즈를 취하세요!
    </text>
  </BfStage>
</template>

<style scoped>
.bf-count {
  font-family: var(--font-pixel), sans-serif;
  font-size: 34px;
}
.bf-cap {
  font-size: 12px;
}
</style>
