<script setup lang="ts">
/** 1장 — 카메라 앞에 서면 화면 속 인형이 나를 그대로 따라 한다. */
import { AVATAR, MUTED, POSE_ONE_UP, PLAYER } from './art'
import BfFigure from './BfFigure.vue'
import BfStage from './BfStage.vue'
</script>

<template>
  <BfStage>
    <!-- 카메라 앞의 나 -->
    <BfFigure :x="76" :y="86" :pose="POSE_ONE_UP" :scale="0.82" :color="PLAYER" />
    <!-- 화면 속 인형 -->
    <rect
      x="176"
      y="42"
      width="126"
      height="130"
      rx="10"
      fill="#151110"
      stroke="#6b5f54"
      stroke-width="3"
    />
    <BfFigure :x="239" :y="92" :pose="POSE_ONE_UP" :scale="0.72" :color="AVATAR" />

    <!-- 똑같이 움직인다는 표시 -->
    <g fill="none" :stroke="MUTED" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M 130 106 L 164 106" />
      <path d="M 156 99 L 164 106 L 156 113" />
    </g>
  </BfStage>
</template>
