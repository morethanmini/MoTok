<script setup lang="ts">
/**
 * 4장 — 구멍 뚫린 벽이 점점 가까이 다가온다.
 * 앞에 내 아바타를 세워 둔다 — 벽만 크기를 바꿔 놓으면 "커진다"이지 "나에게 온다"가 아니다.
 */
import { AVATAR, BG, GOLD, POSE_ONE_UP, POSE_TEAPOT, RIM, SLAB, SLAB_EDGE } from './art'
import BfFigure from './BfFigure.vue'
import BfStage from './BfStage.vue'

/** 멀리 → 가까이. 뒤로 갈수록 크고 진하다. */
const WALLS = [
  { w: 84, h: 88, y: 30, scale: 0.36, opacity: 0.32 },
  { w: 126, h: 130, y: 22, scale: 0.54, opacity: 0.6 },
  { w: 176, h: 176, y: 12, scale: 0.76, opacity: 1 },
]
</script>

<template>
  <BfStage>
    <g v-for="(w, i) in WALLS" :key="i" :opacity="w.opacity">
      <rect
        :x="160 - w.w / 2"
        :y="w.y"
        :width="w.w"
        :height="w.h"
        rx="6"
        :fill="SLAB"
        :stroke="SLAB_EDGE"
        stroke-width="3"
      />
      <BfFigure
        :x="160"
        :y="w.y + w.h * 0.4"
        :pose="POSE_TEAPOT"
        :scale="w.scale"
        :color="RIM"
        :bloat="11 * w.scale + 3"
      />
      <BfFigure
        :x="160"
        :y="w.y + w.h * 0.4"
        :pose="POSE_TEAPOT"
        :scale="w.scale"
        :color="BG"
        :bloat="6 * w.scale + 2"
      />
    </g>

    <!-- 벽이 오고 있는 대상 = 나 -->
    <BfFigure :x="58" :y="118" :pose="POSE_ONE_UP" :scale="0.62" :color="AVATAR" />

    <!-- 나를 향해 온다 -->
    <g
      fill="none"
      :stroke="GOLD"
      stroke-width="4"
      stroke-linecap="round"
      stroke-linejoin="round"
      opacity="0.9"
    >
      <path d="M 140 150 L 108 150 M 118 141 L 108 150 L 118 159" />
    </g>

    <!-- 도착까지 남은 시간 -->
    <rect x="64" y="198" width="192" height="10" rx="5" fill="rgba(255,255,255,0.14)" />
    <rect x="64" y="198" width="126" height="10" rx="5" :fill="GOLD" />
  </BfStage>
</template>
