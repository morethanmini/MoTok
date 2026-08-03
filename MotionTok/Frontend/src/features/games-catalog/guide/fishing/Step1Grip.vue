<script setup lang="ts">
/** 1장 — 두 손을 모아 낚싯대를 쥔다. 한 손이라도 안 보이면 아무것도 시작되지 않는다. */
import { INK } from './art'
import FiHands from './FiHands.vue'
import FiStage from './FiStage.vue'
</script>

<template>
  <FiStage :split="true">
    <FiHands :x="150" :y="180" :angle="-30" :scale="1.4" />
    <!-- 손이 둘이라는 것을 짚어 준다 -->
    <g fill="none" :stroke="INK" stroke-width="2.5" stroke-linecap="round" opacity="0.55">
      <path d="M 118 206 L 130 192" />
      <path d="M 182 206 L 172 194" />
    </g>
    <text class="fi-note" x="118" y="214" text-anchor="middle" :fill="INK">왼손</text>
    <text class="fi-note" x="184" y="214" text-anchor="middle" :fill="INK">오른손</text>
  </FiStage>
</template>

<style scoped>
.fi-note {
  font-size: 11px;
  opacity: 0.75;
}
</style>
