<script setup lang="ts">
/** 2장 — 밤하늘에 별 그림(별자리)이 나타난다. 아직 손은 없다. */
import { LINE, STARS, STAR_PATH, STAR_R, star5 } from './art'
import FsSky from './FsSky.vue'

/**
 * 손이 없는 장이라 아래가 비는데, 별자리를 올려버리면 3장에서 손이 닿는 위치와 어긋나
 * "아까 그 별"로 안 읽힌다. 그래서 자리는 그대로 두고 위쪽 여백만 별똥별로 채운다.
 */
const SHOOTING = [
  { x: 44, y: 34, len: 26 },
  { x: 236, y: 26, len: 32 },
]
</script>

<template>
  <FsSky>
    <!-- 별똥별 -->
    <g stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.45">
      <line
        v-for="(s, i) in SHOOTING"
        :key="i"
        :x1="s.x"
        :y1="s.y"
        :x2="s.x + s.len"
        :y2="s.y + s.len * 0.5"
      />
    </g>

    <!-- 아직 켜지지 않은 별자리 — 점선이라 "따라 만들 자리"로 읽힌다 -->
    <path
      :d="STAR_PATH"
      fill="none"
      :stroke="LINE"
      stroke-width="2.5"
      stroke-dasharray="6 7"
      stroke-linecap="round"
      opacity="0.75"
    />
    <path
      v-for="(s, i) in STARS"
      :key="i"
      :d="star5(s.x, s.y, STAR_R)"
      fill="#1d3160"
      stroke="#ffffff"
      stroke-width="2.5"
      stroke-linejoin="round"
    />
  </FsSky>
</template>
