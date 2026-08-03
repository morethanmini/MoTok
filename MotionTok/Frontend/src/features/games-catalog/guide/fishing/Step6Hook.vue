<script setup lang="ts">
/** 6장 — 입질이 오면(찌가 흔들리면) 두 손을 위로 번쩍 든다. */
import { CORAL, INK, PAPER } from './art'
import FiHands from './FiHands.vue'
import FiStage from './FiStage.vue'
</script>

<template>
  <FiStage :split="true" v-slot="{ geo }">
    <!-- 흔들리는 찌 -->
    <g :transform="`translate(232 ${geo.waterY + 6}) rotate(18)`">
      <path d="M -10 0 A 10 10 0 0 1 10 0 Z" :fill="CORAL" />
      <path d="M -10 0 A 10 10 0 0 0 10 0 Z" :fill="PAPER" />
      <circle cx="0" cy="0" r="10" fill="none" :stroke="INK" stroke-width="3" />
    </g>
    <g fill="none" :stroke="CORAL" stroke-width="3.5" stroke-linecap="round">
      <path :d="`M 206 ${geo.waterY - 4} l -11 -6 M 206 ${geo.waterY + 12} l -12 3`" />
      <path :d="`M 258 ${geo.waterY - 4} l 11 -6 M 258 ${geo.waterY + 12} l 12 3`" />
    </g>
    <text class="fi-bite" x="232" :y="geo.waterY - 24" text-anchor="middle" :fill="CORAL">!!</text>

    <!-- 내렸던 손(흐리게) → 번쩍 든 손 -->
    <g opacity="0.26">
      <FiHands :x="146" :y="200" :angle="6" :scale="1.2" />
    </g>
    <FiHands :x="158" :y="162" :angle="-56" :scale="1.3" />

    <g fill="none" :stroke="INK" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M 78 208 L 78 156 M 69 168 L 78 156 L 87 168" />
    </g>
  </FiStage>
</template>

<style scoped>
.fi-bite {
  font-family: var(--font-pixel), sans-serif;
  font-size: 24px;
}
</style>
