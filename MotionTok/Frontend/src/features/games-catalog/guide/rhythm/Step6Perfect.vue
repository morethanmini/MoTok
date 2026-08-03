<script setup lang="ts">
/** 6장 — 잘 맞히면 PERFECT, 연달아 맞히면 콤보가 쌓이고 점수가 커진다. */
import { COMBO, PERFECT, TEXT } from './art'
import RhStage from './RhStage.vue'

/** 별 4꼭짓점 — 맞힌 순간 튀는 반짝임(실제 화면에서도 금색 별이 튄다). */
function spark(cx: number, cy: number, r: number): string {
  const k = r * 0.28
  return `M ${cx} ${cy - r} Q ${cx + k} ${cy - k} ${cx + r} ${cy} Q ${cx + k} ${cy + k} ${cx} ${cy + r} Q ${cx - k} ${cy + k} ${cx - r} ${cy} Q ${cx - k} ${cy - k} ${cx} ${cy - r} Z`
}
const SPARKS = [
  { x: 74, y: 62, r: 11 },
  { x: 250, y: 70, r: 9 },
  { x: 92, y: 146, r: 8 },
  { x: 238, y: 152, r: 12 },
]
</script>

<template>
  <RhStage>
    <!-- 맞힌 자리에서 퍼지는 파동 -->
    <circle cx="160" cy="104" r="74" fill="none" stroke="#ffffff" stroke-width="5" opacity="0.5" />
    <circle cx="160" cy="104" r="54" fill="#ffffff" opacity="0.45" />

    <path v-for="(s, i) in SPARKS" :key="i" :d="spark(s.x, s.y, s.r)" fill="#ffd66b" />

    <text
      class="rh-judge"
      x="160"
      y="98"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="PERFECT"
    >
      PERFECT!
    </text>
    <text
      class="rh-combo"
      x="160"
      y="134"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="COMBO"
    >
      12 COMBO
    </text>

    <!-- 점수는 화면 왼쪽 위에 쌓인다 -->
    <text class="rh-score" x="22" y="30" dominant-baseline="central" :fill="TEXT">1200</text>
  </RhStage>
</template>

<style scoped>
.rh-judge {
  font-family: var(--font-pixel), sans-serif;
  font-size: 30px;
}
.rh-combo {
  font-family: var(--font-pixel), sans-serif;
  font-size: 17px;
}
.rh-score {
  font-family: var(--font-pixel), sans-serif;
  font-size: 20px;
}
</style>
