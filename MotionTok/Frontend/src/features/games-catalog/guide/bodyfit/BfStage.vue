<script setup lang="ts">
/** 몸 끼워 맞추기 안내 그림의 공통 무대 — 어두운 돌 바닥과 배경. */
import { BG, FLOOR, VIEW_H, VIEW_W } from './art'

const uid = `bf-bg-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <svg class="bf-art" :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" role="img" aria-hidden="true">
    <defs>
      <radialGradient :id="uid" cx="0.5" cy="0.42" r="0.75">
        <stop offset="0" stop-color="#332b26" />
        <stop offset="1" :stop-color="BG" />
      </radialGradient>
    </defs>
    <rect x="0" y="0" :width="VIEW_W" :height="VIEW_H" :fill="`url(#${uid})`" />
    <!-- 바닥 — 여기 서 있다는 것만 알려 주면 된다 -->
    <path :d="`M 0 ${VIEW_H} L 0 178 L ${VIEW_W} 178 L ${VIEW_W} ${VIEW_H} Z`" :fill="FLOOR" />
    <line x1="0" y1="178" :x2="VIEW_W" y2="178" stroke="#5a4d43" stroke-width="2" />
    <slot />
  </svg>
</template>

<style scoped>
.bf-art {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
