<script setup lang="ts">
/**
 * 3장 — 다가오던 원이 판정 원과 딱 겹치는 순간 손을 댄다.
 * 주먹이 아니라 <b>편 손</b>이다(art.ts의 오래된 안내 문구 주석 참고).
 */
import { NOTE_R, PAW_R, RING } from './art'
import RhPaw from './RhPaw.vue'
import RhStage from './RhStage.vue'

const NOTE = { x: 150, y: 104 }
const NOTE_SIZE = 62
</script>

<template>
  <RhStage>
    <!-- 아직 먼 원 → 겹친 원 순서로 보여 준다 -->
    <circle
      :cx="NOTE.x"
      :cy="NOTE.y"
      r="70"
      fill="none"
      :stroke="RING"
      stroke-width="2.5"
      stroke-dasharray="5 7"
      opacity="0.4"
    />
    <g :stroke="RING" stroke-width="2" opacity="0.45" stroke-linecap="round">
      <path d="M 88 60 L 100 72 M 212 60 L 200 72 M 88 148 L 100 136 M 212 148 L 200 136" />
    </g>

    <!-- 맞히는 순간 — 흰 링이 퍼진다 -->
    <circle :cx="NOTE.x" :cy="NOTE.y" r="46" fill="#ffffff" opacity="0.55" />
    <circle
      :cx="NOTE.x"
      :cy="NOTE.y"
      :r="NOTE_SIZE / 2 + 5"
      fill="none"
      stroke="#ffffff"
      stroke-width="5"
    />
    <RhPaw
      :x="NOTE.x"
      :y="NOTE.y"
      :size="NOTE_SIZE"
      :fill="NOTE_R.fill"
      :edge="NOTE_R.edge"
      letter="R"
    />

    <!-- 오른손 커서를 그 위에 얹는다 -->
    <RhPaw :x="204" :y="152" :size="58" :fill="PAW_R.fill" :edge="PAW_R.edge" />
    <g stroke="#ffffff" stroke-width="4" stroke-linecap="round" fill="none" opacity="0.9">
      <path d="M 190 138 L 172 122" />
      <path d="M 172 122 l 9 1 M 172 122 l 1 9" />
    </g>
  </RhStage>
</template>
