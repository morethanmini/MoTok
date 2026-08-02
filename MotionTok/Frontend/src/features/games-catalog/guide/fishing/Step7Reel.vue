<script setup lang="ts">
/**
 * 7장 — 한 손은 대를 잡고 가만히, 다른 손으로 줄을 감는다.
 *
 * 실제 판정도 <b>한쪽 손목의 위아래 움직임</b>을 센다(fishing/pump.ts). 그래서 원을 그리는
 * 그림이 아니라 위아래 잔상으로 그린다 — 첫 시안의 "빙글빙글"은 판정과 다른 동작을 가르쳤다.
 */
import { INK, MINT, fishPath } from './art'
import FiHands from './FiHands.vue'
import FiStage from './FiStage.vue'

/** 감기 게이지 — 초록으로 차오르면 잡히는 중. */
const FILL = 0.68
/** 감는 손의 위아래 잔상 위치. */
const GHOSTS = [
  { y: 152, o: 0.22 },
  { y: 200, o: 0.22 },
]
const REEL_X = 214
</script>

<template>
  <FiStage :split="true" v-slot="{ geo }">
    <!-- 끌려 올라오는 물고기 -->
    <line
      x1="206"
      :y1="geo.waterY"
      x2="206"
      :y2="geo.sandY - 20"
      :stroke="INK"
      stroke-width="2"
      opacity="0.55"
    />
    <path
      :d="fishPath(220, geo.sandY - 20, 44)"
      fill="#8fa6c9"
      :stroke="INK"
      stroke-width="3"
      stroke-linejoin="round"
    />
    <circle cx="228" :cy="geo.sandY - 23" r="2.4" :fill="INK" />
    <g fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.8">
      <path
        :d="`M 206 ${geo.sandY - 40} L 206 ${geo.waterY + 12} M 200 ${geo.waterY + 20} L 206 ${geo.waterY + 12} L 212 ${geo.waterY + 20}`"
      />
    </g>

    <!-- 대를 잡은 손 — 움직이지 않는다 -->
    <FiHands :x="98" :y="176" :angle="-26" :count="1" :scale="1.35" />
    <g fill="none" :stroke="INK" stroke-width="2.5" stroke-dasharray="4 5" opacity="0.5">
      <circle cx="98" cy="176" r="27" />
    </g>
    <text class="fi-note" x="98" y="214" text-anchor="middle" :fill="INK">고정</text>

    <!-- 줄을 감는 손 — 위아래로 오간다 -->
    <g v-for="(g, i) in GHOSTS" :key="i" :opacity="g.o">
      <FiHands :x="REEL_X" :y="g.y" :angle="0" :rod="false" :count="1" :scale="1.25" />
    </g>
    <FiHands :x="REEL_X" :y="176" :angle="0" :rod="false" :count="1" :scale="1.35" />
    <g fill="none" :stroke="INK" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <path
        :d="`M ${REEL_X + 34} 158 L ${REEL_X + 34} 144 M ${REEL_X + 28} 151 L ${REEL_X + 34} 144 L ${REEL_X + 40} 151`"
      />
      <path
        :d="`M ${REEL_X + 34} 194 L ${REEL_X + 34} 208 M ${REEL_X + 28} 201 L ${REEL_X + 34} 208 L ${REEL_X + 40} 201`"
      />
    </g>

    <!-- 감기 게이지 -->
    <rect
      x="20"
      y="136"
      width="120"
      height="12"
      rx="6"
      fill="#ffffff"
      :stroke="INK"
      stroke-width="2.5"
    />
    <rect x="23" y="139" :width="114 * FILL" height="6" rx="3" :fill="MINT" />
  </FiStage>
</template>

<style scoped>
.fi-note {
  font-size: 11px;
  opacity: 0.7;
}
</style>
