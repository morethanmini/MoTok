<script setup lang="ts">
/**
 * 4장 — 다 짚은 채로 3초 버틴다.
 * 3장과 그림이 거의 같아서, 다른 점(금색 별자리 + 게이지 + 숫자 3)을 크고 분명하게 준다.
 */
import { GOLD, LINE, STARS, STAR_PATH, STAR_R, star5 } from './art'
import FsHands from './FsHands.vue'
import FsSky from './FsSky.vue'

const HOLD_SECONDS = 3
/** 게이지가 다 차기 직전 — "조금만 더"가 보여야 가만히 있으라는 말이 통한다. */
const GAUGE_FILL = 0.72
const GAUGE = { x: 96, y: 26, w: 128, h: 13 }
</script>

<template>
  <FsSky>
    <!-- 홀드 게이지 -->
    <rect
      :x="GAUGE.x"
      :y="GAUGE.y"
      :width="GAUGE.w"
      :height="GAUGE.h"
      :rx="GAUGE.h / 2"
      fill="rgba(255,255,255,0.14)"
      stroke="#ffffff"
      stroke-width="2"
      opacity="0.9"
    />
    <rect
      :x="GAUGE.x + 2"
      :y="GAUGE.y + 2"
      :width="(GAUGE.w - 4) * GAUGE_FILL"
      :height="GAUGE.h - 4"
      :rx="(GAUGE.h - 4) / 2"
      :fill="GOLD"
    />

    <!-- 남은 시간 -->
    <circle cx="160" cy="80" r="26" :fill="GOLD" stroke="#ffffff" stroke-width="3" />
    <text
      class="fs-num"
      x="160"
      y="80"
      text-anchor="middle"
      dominant-baseline="central"
      fill="#3e2e24"
    >
      {{ HOLD_SECONDS }}
    </text>

    <!-- 완성 직전이라 선도 별도 금색 -->
    <path :d="STAR_PATH" fill="none" :stroke="GOLD" stroke-width="4" stroke-linecap="round" />
    <g>
      <circle
        v-for="(s, i) in STARS"
        :key="`g${i}`"
        :cx="s.x"
        :cy="s.y"
        r="15"
        :fill="GOLD"
        opacity="0.2"
      />
      <path
        v-for="(s, i) in STARS"
        :key="i"
        :d="star5(s.x, s.y, STAR_R + 2)"
        :fill="GOLD"
        stroke="#ffffff"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </g>

    <FsHands />

    <!-- "이 자리 그대로" — 손 전체를 감싸는 점선 틀. 손 옆에 세우는 정지선은
         그냥 막대기로 보여서(첫 시안) 손을 통째로 묶는 쪽으로 바꿨다. -->
    <rect
      x="34"
      y="110"
      width="254"
      height="98"
      rx="14"
      fill="none"
      :stroke="LINE"
      stroke-width="2.5"
      stroke-dasharray="9 8"
      opacity="0.6"
    />
  </FsSky>
</template>

<style scoped>
.fs-num {
  font-family: var(--font-pixel), sans-serif;
  font-size: 30px;
}
</style>
