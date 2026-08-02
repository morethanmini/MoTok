<script setup lang="ts">
/** 1장 — 친구 셋이 도화지 하나를 둘러싼다(3명부터 되는 협동 게임). */
import { INK, PAINTER_COLORS, SKIN, SKIN_EDGE } from './art'
import DrStage from './DrStage.vue'

/** 도화지를 둘러싼 세 명. 옷 색은 뒤 장에서도 같은 순서로 쓴다. */
const KIDS = [
  { x: 26, y: 150 },
  { x: 160, y: 178 },
  { x: 294, y: 150 },
]
</script>

<template>
  <DrStage :paper="true">
    <!-- 아직 비어 있는 도화지 위의 물음표 — 무엇을 그릴지는 다음 장에서 -->
    <text class="dr-q" x="160" y="106" text-anchor="middle" dominant-baseline="central" :fill="INK">
      ?
    </text>

    <!-- 셋이 같은 종이를 향한다 -->
    <g v-for="(k, i) in KIDS" :key="i">
      <circle
        :cx="k.x"
        :cy="k.y"
        r="21"
        :fill="PAINTER_COLORS[i]"
        stroke="#fffaf0"
        stroke-width="3"
      />
      <circle :cx="k.x" :cy="k.y - 6" r="12" :fill="SKIN_EDGE" />
      <circle :cx="k.x" :cy="k.y - 6" r="10" :fill="SKIN" />
      <circle :cx="k.x - 4" :cy="k.y - 7" r="1.7" :fill="INK" />
      <circle :cx="k.x + 4" :cy="k.y - 7" r="1.7" :fill="INK" />
      <path
        :d="`M ${k.x - 4} ${k.y - 1} Q ${k.x} ${k.y + 2} ${k.x + 4} ${k.y - 1}`"
        fill="none"
        :stroke="INK"
        stroke-width="1.6"
      />
    </g>

    <!-- 셋 다 이 종이를 그린다는 표시 -->
    <g
      fill="none"
      stroke="#a89882"
      stroke-width="2.5"
      stroke-dasharray="5 5"
      stroke-linecap="round"
    >
      <path d="M 42 138 Q 52 118 68 108" />
      <path d="M 160 158 L 160 136" />
      <path d="M 278 138 Q 268 118 252 108" />
    </g>
  </DrStage>
</template>

<style scoped>
.dr-q {
  font-family: var(--font-pixel), sans-serif;
  font-size: 56px;
  opacity: 0.28;
}
</style>
