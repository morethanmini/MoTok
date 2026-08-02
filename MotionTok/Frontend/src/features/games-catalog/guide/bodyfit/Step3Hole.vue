<script setup lang="ts">
/**
 * 3장 — 출제자의 포즈가 그대로 벽 구멍이 된다.
 *
 * 구멍은 <b>같은 포즈를 더 굵게 그린 것</b>이라(bloat) 사람과 저절로 맞물린다.
 * 실제 게임도 목표 실루엣을 1.45~1.9배로 부풀려 구멍을 만든다 — 그래서 조금 어긋나도 통과한다.
 * 마스크를 쓰지 않고 "테두리 → 구멍" 순서로 겹쳐 그린다(마스크 안의 컴포넌트는 빌드에서
 * 다루기 까다롭고, 여기서는 겹쳐 그리는 것으로 같은 그림이 나온다).
 */
import { BG, POSE_TEAPOT, PLAYER, RIM, RIM_GLOW, SLAB, SLAB_EDGE } from './art'
import BfFigure from './BfFigure.vue'
import BfStage from './BfStage.vue'

const HOLE = { x: 220, y: 88 }
const SCALE = 0.78
</script>

<template>
  <BfStage>
    <!-- 방금 그 포즈 -->
    <BfFigure :x="62" :y="92" :pose="POSE_TEAPOT" :scale="0.6" :color="PLAYER" />

    <!-- 그대로 벽에 뚫린다 -->
    <g fill="none" stroke="#7d7059" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M 104 106 L 134 106" />
      <path d="M 126 99 L 134 106 L 126 113" />
    </g>

    <rect
      x="152"
      y="20"
      width="146"
      height="152"
      rx="6"
      :fill="SLAB"
      :stroke="SLAB_EDGE"
      stroke-width="3"
    />
    <BfFigure
      :x="HOLE.x"
      :y="HOLE.y"
      :pose="POSE_TEAPOT"
      :scale="SCALE"
      :color="RIM_GLOW"
      :bloat="15"
      opacity="0.3"
    />
    <BfFigure :x="HOLE.x" :y="HOLE.y" :pose="POSE_TEAPOT" :scale="SCALE" :color="RIM" :bloat="11" />
    <BfFigure :x="HOLE.x" :y="HOLE.y" :pose="POSE_TEAPOT" :scale="SCALE" :color="BG" :bloat="6" />
  </BfStage>
</template>
