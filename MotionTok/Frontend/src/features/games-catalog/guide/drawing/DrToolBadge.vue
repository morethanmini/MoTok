<script setup lang="ts">
/**
 * "이 손은 지금 무슨 도구인가"를 알려 주는 칩 (SVG 조각 — DrStage의 slot 안에 넣어 쓴다).
 *
 * 도구를 손에 쥐여 주지 않고 따로 띄우는 이유 — 이 게임은 <b>맨손</b>으로 한다.
 * 연필을 쥔 손을 그리면 "연필이 있어야 하나?"가 되고, 손 모양(OK·주먹)이 도구를 정한다는
 * 규칙 자체가 흐려진다. 도구는 손이 아니라 결과를 가리키는 표시라 배지로 뒀다.
 */
import { ERASER, GOLD, INK } from './art'

defineProps<{ tool: 'pencil' | 'eraser'; x: number; y: number }>()

/**
 * 칩 한 변. 도구를 비스듬히 눕혀 두므로 실제로 필요한 건 대각선 길이다 —
 * 도구 길이에 딱 맞추면 회전한 끝이 모서리 밖으로 삐져나온다(첫 시안이 그랬다).
 */
const BADGE = 52
</script>

<template>
  <g>
    <rect
      :x="x - BADGE / 2"
      :y="y - BADGE / 2"
      :width="BADGE"
      :height="BADGE"
      rx="13"
      fill="#fffaf0"
      :stroke="INK"
      stroke-width="3"
    />

    <!-- 연필 — 지우개 꼭지 · 금속 띠 · 몸통 · 깎인 나무 · 심 -->
    <g
      v-if="tool === 'pencil'"
      :transform="`translate(${x} ${y}) rotate(-40)`"
      :stroke="INK"
      stroke-width="2.4"
      stroke-linejoin="round"
    >
      <rect x="-24" y="-7" width="10" height="14" rx="3.5" fill="#ff9db0" />
      <rect x="-15" y="-7" width="5" height="14" fill="#cdcdd6" />
      <rect x="-11" y="-7" width="23" height="14" :fill="GOLD" />
      <path d="M 12 -7 L 24 0 L 12 7 Z" fill="#f2ddbe" />
      <path d="M 19 -3 L 24 0 L 19 3 Z" :fill="INK" />
    </g>

    <!-- 지우개 — 가운데 종이 띠를 두른 네모 -->
    <g
      v-else
      :transform="`translate(${x} ${y}) rotate(-18)`"
      :stroke="INK"
      stroke-width="2.4"
      stroke-linejoin="round"
    >
      <rect x="-19" y="-12" width="38" height="24" rx="5" :fill="ERASER" />
      <rect x="-5" y="-12" width="12" height="24" fill="#ffe1e6" />
      <!-- 지운 자리에서 나온 부스러기 -->
      <g stroke="none" :fill="ERASER">
        <circle cx="17" cy="14" r="2.4" />
        <circle cx="12" cy="19" r="1.8" />
      </g>
    </g>
  </g>
</template>
