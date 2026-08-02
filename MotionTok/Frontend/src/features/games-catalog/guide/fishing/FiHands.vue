<script setup lang="ts">
/**
 * 낚싯대를 쥔 두 손 (SVG 조각).
 *
 * 이 게임의 조작은 전부 "두 손을 어디로 움직이나"라서, 장마다 이 조각을 각도·위치만
 * 바꿔 놓는다 — 같은 손이 움직이는 것으로 보여야 던지기·깊이·챔질이 한 동작의 변형으로 읽힌다.
 */
import { INK, SKIN, SKIN_EDGE } from './art'

withDefaults(
  defineProps<{
    x: number
    y: number
    /** 대의 기울기(도). 0이면 수평, 음수면 앞쪽이 위로. */
    angle?: number
    /** 대를 그릴지 — 감기(한 손) 장에서는 끈다. */
    rod?: boolean
    /** 손 개수. 줄을 감는 장은 한 손씩 따로 그린다. */
    count?: 1 | 2
    scale?: number
  }>(),
  { angle: -30, rod: true, count: 2, scale: 1 },
)
</script>

<template>
  <g :transform="`translate(${x} ${y}) rotate(${angle}) scale(${scale})`">
    <!-- 낚싯대 -->
    <line
      v-if="rod"
      x1="-26"
      y1="0"
      x2="86"
      y2="0"
      :stroke="INK"
      stroke-width="4"
      stroke-linecap="round"
    />
    <!-- 두 손이 앞뒤로 대를 쥔다. 손가락 골을 그어야 덩어리가 아니라 쥔 손으로 보인다 -->
    <g v-for="cx in count === 1 ? [0] : [-8, 20]" :key="cx">
      <ellipse
        :cx="cx"
        cy="0"
        rx="14"
        ry="12.5"
        :fill="SKIN"
        :stroke="SKIN_EDGE"
        stroke-width="3"
      />
      <g :stroke="SKIN_EDGE" stroke-width="2" stroke-linecap="round" opacity="0.55">
        <line v-for="d in [-6, 0, 6]" :key="d" :x1="cx + d" y1="-9" :x2="cx + d" y2="9" />
      </g>
    </g>
  </g>
</template>
