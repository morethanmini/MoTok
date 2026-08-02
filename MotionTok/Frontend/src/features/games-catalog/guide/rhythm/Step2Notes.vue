<script setup lang="ts">
/** 2장 — 발바닥 음표가 나타난다. 아직 멀어서 원이 크다. */
import { NOTE_ANY, NOTE_L, NOTE_R, RING } from './art'
import RhPaw from './RhPaw.vue'
import RhStage from './RhStage.vue'

/** 다가오는 원이 클수록 아직 멀었다는 뜻 — 3장에서 딱 겹치는 것과 대비된다. */
const NOTES = [
  { x: 74, y: 78, note: NOTE_L, letter: 'L', ring: 40 },
  { x: 232, y: 70, note: NOTE_R, letter: 'R', ring: 44 },
  { x: 158, y: 152, note: NOTE_ANY, letter: '', ring: 36 },
]
const NOTE_SIZE = 44
</script>

<template>
  <RhStage>
    <g v-for="(n, i) in NOTES" :key="i">
      <!-- 다가오는 원 -->
      <circle :cx="n.x" :cy="n.y" :r="n.ring" fill="none" :stroke="RING" stroke-width="3" />
      <!-- 판정 원(고정) -->
      <circle
        :cx="n.x"
        :cy="n.y"
        :r="NOTE_SIZE / 2 + 4"
        fill="none"
        :stroke="RING"
        stroke-width="2"
        stroke-dasharray="4 5"
        opacity="0.7"
      />
      <RhPaw
        :x="n.x"
        :y="n.y"
        :size="NOTE_SIZE"
        :fill="n.note.fill"
        :edge="n.note.edge"
        :letter="n.letter"
      />
    </g>
  </RhStage>
</template>
