<script setup lang="ts">
/** 캐치캐치리듬 안내 그림의 공통 무대 — 복숭아색 배경 + 은은한 격자. */
import { BG_BOT, BG_TOP, VIEW_H, VIEW_W } from './art'

const uid = `rh-bg-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <svg class="rh-art" :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" role="img" aria-hidden="true">
    <defs>
      <linearGradient :id="uid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :stop-color="BG_TOP" />
        <stop offset="1" :stop-color="BG_BOT" />
      </linearGradient>
      <pattern :id="`${uid}-w`" width="16" height="16" patternUnits="userSpaceOnUse">
        <path d="M 0 8 H 16 M 8 0 V 16" stroke="rgba(198,146,116,0.12)" stroke-width="2" />
      </pattern>
    </defs>
    <rect x="0" y="0" :width="VIEW_W" :height="VIEW_H" :fill="`url(#${uid})`" />
    <rect x="0" y="0" :width="VIEW_W" :height="VIEW_H" :fill="`url(#${uid}-w)`" />
    <slot />
  </svg>
</template>

<style scoped>
.rh-art {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
