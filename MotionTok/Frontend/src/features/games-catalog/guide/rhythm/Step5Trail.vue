<script setup lang="ts">
/** 5장 — 길게 이어진 음표는 잡고 끝까지 손으로 따라간다. */
import { NOTE_L, PAW_L } from './art'
import RhPaw from './RhPaw.vue'
import RhStage from './RhStage.vue'

/** 리본 경로 — 머리(왼쪽)에서 꼬리(오른쪽)로. */
const TRAIL = 'M 66 148 Q 118 62 168 124 Q 214 176 258 96'
</script>

<template>
  <RhStage>
    <!-- 리본: 굵은 띠 위에 지나온 만큼을 진하게 -->
    <path
      :d="TRAIL"
      fill="none"
      :stroke="NOTE_L.fill"
      stroke-width="26"
      stroke-linecap="round"
      opacity="0.45"
    />
    <path
      :d="TRAIL"
      fill="none"
      :stroke="NOTE_L.edge"
      stroke-width="26"
      stroke-linecap="round"
      opacity="0.28"
      stroke-dasharray="120 400"
    />
    <path
      :d="TRAIL"
      fill="none"
      stroke="#ffffff"
      stroke-width="3"
      stroke-linecap="round"
      stroke-dasharray="2 10"
      opacity="0.8"
    />

    <!-- 머리 = 처음 잡는 자리 -->
    <RhPaw :x="66" :y="148" :size="52" :fill="NOTE_L.fill" :edge="NOTE_L.edge" letter="L" />

    <!-- 지금 따라가는 중인 손 커서 -->
    <RhPaw :x="168" :y="124" :size="54" :fill="PAW_L.fill" :edge="PAW_L.edge" />

    <!-- 끝까지 가라는 화살표 -->
    <g fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity="0.95">
      <path d="M 236 116 L 256 100 M 248 100 L 256 100 L 256 108" />
    </g>
  </RhStage>
</template>
