<script setup lang="ts">
/**
 * 5장 — 깊은 층일수록 크고 점수 높은 물고기가 산다.
 * 이 장만 낚시터가 화면 전체를 쓴다(손 이야기가 없어서 아래 칸이 필요 없다).
 */
import { INK, YELLOW, fishPath } from './art'
import FiStage from './FiStage.vue'

/**
 * 층마다 대표 한 마리 — 아래로 갈수록 커지고 점수도 커진다.
 * 실제 어종은 15종이라 이름을 다 적으면 외울 거리가 되어 버린다. 여기서는 "깊을수록 크다"만.
 */
const LAYERS = [
  { len: 26, score: 5, fill: '#ffb066' },
  { len: 36, score: 25, fill: '#ff8f6b' },
  { len: 48, score: 60, fill: '#c9e08a' },
  { len: 62, score: 120, fill: '#8fa6c9' },
]
</script>

<template>
  <FiStage :boat="false" :bands="true" v-slot="{ edges }">
    <g v-for="(l, i) in LAYERS" :key="i">
      <path
        :d="fishPath(126, ((edges[i] ?? 0) + (edges[i + 1] ?? 0)) / 2, l.len)"
        :fill="l.fill"
        :stroke="INK"
        stroke-width="3"
        stroke-linejoin="round"
      />
      <circle
        :cx="126 + l.len * 0.17"
        :cy="((edges[i] ?? 0) + (edges[i + 1] ?? 0)) / 2 - 3"
        r="2.6"
        :fill="INK"
      />
      <rect
        x="220"
        :y="((edges[i] ?? 0) + (edges[i + 1] ?? 0)) / 2 - 13"
        width="66"
        height="26"
        rx="13"
        :fill="YELLOW"
        :stroke="INK"
        stroke-width="2.5"
      />
      <text
        class="fi-score"
        x="253"
        :y="((edges[i] ?? 0) + (edges[i + 1] ?? 0)) / 2"
        text-anchor="middle"
        dominant-baseline="central"
        :fill="INK"
      >
        {{ l.score }}점
      </text>
    </g>

    <!-- 아래로 갈수록 커진다 -->
    <g
      fill="none"
      :stroke="INK"
      stroke-width="3.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      opacity="0.6"
    >
      <path d="M 42 92 L 42 182 M 34 172 L 42 182 L 50 172" />
    </g>
  </FiStage>
</template>

<style scoped>
.fi-score {
  font-family: var(--font-pixel), sans-serif;
  font-size: 13px;
}
</style>
