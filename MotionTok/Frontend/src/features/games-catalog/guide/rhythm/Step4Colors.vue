<script setup lang="ts">
/** 4장 — 색이 어느 손으로 잡을지를 말해 준다. 파랑=왼손, 빨강=오른손, 보라=아무 손. */
import { NOTE_ANY, NOTE_L, NOTE_R, PAW_L, PAW_R, TEXT } from './art'
import RhPaw from './RhPaw.vue'
import RhStage from './RhStage.vue'

/** 음표 아래에 그 손의 커서를 놓아 짝을 눈으로 잇는다. 보라는 양쪽 다 놓는다. */
const COLUMNS = [
  { x: 62, note: NOTE_L, letter: 'L', paws: [PAW_L] },
  { x: 160, note: NOTE_R, letter: 'R', paws: [PAW_R] },
  { x: 258, note: NOTE_ANY, letter: '', paws: [PAW_L, PAW_R] },
]
</script>

<template>
  <RhStage>
    <g v-for="(c, i) in COLUMNS" :key="i">
      <RhPaw
        :x="c.x"
        :y="74"
        :size="58"
        :fill="c.note.fill"
        :edge="c.note.edge"
        :letter="c.letter"
      />
      <!-- 이 음표는 이 손 -->
      <path
        :d="`M ${c.x} 112 L ${c.x} 134 M ${c.x - 5} 128 L ${c.x} 134 L ${c.x + 5} 128`"
        fill="none"
        :stroke="TEXT"
        stroke-width="2.5"
        stroke-linecap="round"
        opacity="0.55"
      />
      <RhPaw
        v-for="(p, pi) in c.paws"
        :key="pi"
        :x="c.x + (c.paws.length > 1 ? (pi === 0 ? -19 : 19) : 0)"
        :y="166"
        :size="c.paws.length > 1 ? 40 : 50"
        :fill="p.fill"
        :edge="p.edge"
      />
    </g>
  </RhStage>
</template>
