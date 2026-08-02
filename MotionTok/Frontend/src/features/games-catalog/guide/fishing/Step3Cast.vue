<script setup lang="ts">
/**
 * 3장 — 두 손을 앞으로 내밀면 찌가 날아간다.
 *
 * "앞으로"는 화면 밖(카메라 쪽)이라 2차원으로는 그릴 수 없다. 뒤에 있던 손을 작고 흐리게,
 * 내민 손을 크고 진하게 그려 <b>가까워졌다</b>로 읽히게 한다 — 아래로 내리는 그림으로는
 * 던지기가 아니라 팔 내리기로 보인다.
 */
import { CORAL, INK, PAPER } from './art'
import FiHands from './FiHands.vue'
import FiStage from './FiStage.vue'
</script>

<template>
  <FiStage :split="true" v-slot="{ geo }">
    <!-- 찌가 그리는 포물선 -->
    <path
      :d="`M 76 ${geo.waterY - 16} Q 160 ${geo.waterY - 56} 244 ${geo.waterY}`"
      fill="none"
      :stroke="INK"
      stroke-width="2.5"
      stroke-dasharray="4 7"
      opacity="0.45"
    />
    <g transform="translate(166 6)">
      <path d="M -9 0 A 9 9 0 0 1 9 0 Z" :fill="CORAL" />
      <path d="M -9 0 A 9 9 0 0 0 9 0 Z" :fill="PAPER" />
      <circle cx="0" cy="0" r="9" fill="none" :stroke="INK" stroke-width="2.5" />
    </g>

    <!-- 뒤에 있던 손(작고 흐리게) -->
    <g opacity="0.3">
      <FiHands :x="102" :y="166" :angle="-30" :scale="0.9" />
    </g>
    <!-- 앞으로 내민 손(크고 진하게) -->
    <FiHands :x="186" :y="184" :angle="-22" :scale="1.5" />

    <!-- 앞으로 나온다는 잔상 -->
    <g fill="none" :stroke="INK" stroke-width="3" stroke-linecap="round" opacity="0.35">
      <path d="M 118 196 L 146 200" />
      <path d="M 112 178 L 138 184" />
      <path d="M 124 212 L 150 214" />
    </g>
    <g fill="none" :stroke="INK" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M 236 200 L 264 200 M 255 191 L 264 200 L 255 209" />
    </g>
  </FiStage>
</template>
