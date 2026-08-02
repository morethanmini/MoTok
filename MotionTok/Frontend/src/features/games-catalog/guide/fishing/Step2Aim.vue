<script setup lang="ts">
/** 2장 — 손을 좌우로 움직이면 던질 자리(표적)가 따라 움직인다. */
import { CORAL, INK, MINT } from './art'
import FiHands from './FiHands.vue'
import FiStage from './FiStage.vue'
</script>

<template>
  <FiStage :split="true" v-slot="{ geo }">
    <!-- 던질 수 있는 범위 -->
    <rect x="100" :y="geo.waterY - 5" width="196" height="10" rx="5" :fill="MINT" opacity="0.5" />
    <!-- 겨냥선과 표적 -->
    <path
      :d="`M 60 ${geo.waterY - 22} Q 150 ${geo.waterY - 40} 244 ${geo.waterY}`"
      fill="none"
      :stroke="INK"
      stroke-width="2.5"
      stroke-dasharray="5 6"
      opacity="0.5"
    />
    <circle cx="244" :cy="geo.waterY" r="13" fill="none" stroke="#ffffff" stroke-width="4" />
    <circle cx="244" :cy="geo.waterY" r="5" :fill="CORAL" />

    <!-- 손을 좌우로 -->
    <FiHands :x="150" :y="180" :angle="-28" :scale="1.25" />
    <g fill="none" :stroke="INK" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M 92 180 L 66 180 M 75 172 L 66 180 L 75 188" />
      <path d="M 208 180 L 234 180 M 225 172 L 234 180 L 225 188" />
    </g>
  </FiStage>
</template>
