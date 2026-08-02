<script setup lang="ts">
/** 2장 — 무엇을 그릴지(주제어)가 나온다. 게임 상단 바의 금색 주제어 띠 그대로. */
import { CAT_BODY, CAT_EYES, CAT_FACE, CAT_HEAD, GOLD, INK, catAt } from './art'
import DrStage from './DrStage.vue'

/** 실제 게임의 주제어 자리 — 아이가 읽을 수 있는 짧은 낱말로. */
const TOPIC = '고양이'
</script>

<template>
  <DrStage :paper="true">
    <!-- 주제어 띠 -->
    <rect
      x="72"
      y="18"
      width="176"
      height="42"
      rx="10"
      :fill="GOLD"
      :stroke="INK"
      stroke-width="3"
    />
    <text
      class="dr-topic"
      x="160"
      y="40"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="INK"
    >
      {{ TOPIC }}
    </text>

    <!-- 무엇을 그릴지는 알지만 종이는 아직 비어 있다 — 옅은 밑그림으로 보여 준다 -->
    <g
      :transform="catAt(160, 132, 0.62)"
      fill="none"
      :stroke="INK"
      stroke-width="4"
      stroke-linecap="round"
      stroke-linejoin="round"
      opacity="0.18"
    >
      <path :d="CAT_HEAD" />
      <path :d="CAT_FACE" />
      <path :d="CAT_BODY" />
      <circle
        v-for="(e, i) in CAT_EYES"
        :key="i"
        :cx="e.x"
        :cy="e.y"
        r="3"
        :fill="INK"
        stroke="none"
      />
    </g>
  </DrStage>
</template>

<style scoped>
.dr-topic {
  font-family: var(--font-pixel), sans-serif;
  font-size: 24px;
}
</style>
