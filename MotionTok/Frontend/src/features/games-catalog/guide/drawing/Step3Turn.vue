<script setup lang="ts">
/** 3장 — 내 차례에만 그린다. 앞사람이 그린 만큼(머리)이 남아 있고 그 위에 이어 그린다. */
import {
  CAT_EYES,
  CAT_FACE,
  CAT_HEAD,
  INK,
  PAINTER_COLORS,
  PEN_CURSOR,
  TIME_FILL,
  catAt,
} from './art'
import DrStage from './DrStage.vue'

/** 지금 차례는 두 번째 사람 — 앞은 끝났고 뒤는 기다린다. */
const TURN = 1
const TIME_LEFT = 0.55
</script>

<template>
  <DrStage :paper="true">
    <!-- 앞사람이 그려 둔 부분 — 도화지는 한 장이고 지워지지 않는다 -->
    <g
      :transform="catAt(160, 118, 0.62)"
      fill="none"
      :stroke="INK"
      stroke-width="4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path :d="CAT_HEAD" />
      <path :d="CAT_FACE" opacity="0.9" />
      <circle
        v-for="(e, i) in CAT_EYES"
        :key="i"
        :cx="e.x"
        :cy="e.y"
        r="3"
        :fill="INK"
        stroke="none"
      />
    </g>

    <!-- 지금 그리고 있는 획 — 앞사람이 그린 머리에서 이어져 나온다.
         여기서 떨어뜨리면 남의 그림 옆에 딴 걸 그리는 것처럼 보여 "이어 그리기"가 안 읽힌다 -->
    <path
      d="M 141 127 Q 144 158 178 161"
      fill="none"
      :stroke="INK"
      stroke-width="4"
      stroke-linecap="round"
    />
    <circle cx="178" cy="161" r="6" :fill="PEN_CURSOR" />

    <!-- 차례 표시 — 색으로 누가 그리는 중인지 -->
    <g>
      <g v-for="i in 3" :key="i">
        <circle
          :cx="118 + (i - 1) * 42"
          cy="200"
          :r="i - 1 === TURN ? 12 : 8"
          :fill="PAINTER_COLORS[i - 1]"
          :opacity="i - 1 === TURN ? 1 : 0.35"
          :stroke="i - 1 === TURN ? INK : 'none'"
          stroke-width="3"
        />
      </g>
      <!-- 순서대로 넘어간다는 화살표 -->
      <g :stroke="INK" stroke-width="2" opacity="0.45" stroke-linecap="round" fill="none">
        <path d="M 133 200 L 145 200 M 141 197 L 145 200 L 141 203" />
        <path d="M 175 200 L 187 200 M 183 197 L 187 200 L 183 203" />
      </g>
    </g>

    <!-- 내 차례에 남은 시간 -->
    <rect x="60" y="16" width="200" height="9" rx="4.5" fill="rgba(38,38,46,0.14)" />
    <rect x="60" y="16" :width="200 * TIME_LEFT" height="9" rx="4.5" :fill="TIME_FILL" />
  </DrStage>
</template>
