<script setup lang="ts">
/** 4장 — 손을 올리면 미끼가 뜨고, 내리면 가라앉는다. */
import { CORAL, INK, PAPER } from './art'
import FiHands from './FiHands.vue'
import FiStage from './FiStage.vue'

/** 지금 미끼가 있는 층(위에서 세 번째). 그 층만 밝게 칠해 지금 깊이를 알려 준다. */
const BAND = 2
const BOB_X = 226
/** 손의 위아래 잔상 — 높이를 바꾸는 동작이라는 걸 정지 그림으로 말하는 유일한 방법이다. */
const GHOSTS = [
  { y: 152, o: 0.24 },
  { y: 200, o: 0.24 },
]
</script>

<template>
  <FiStage :split="true" :bands="true" v-slot="{ geo, edges }">
    <rect
      x="0"
      :y="edges[BAND]"
      width="320"
      :height="(edges[BAND + 1] ?? 0) - (edges[BAND] ?? 0)"
      fill="rgba(255,255,255,0.2)"
    />

    <line
      :x1="BOB_X"
      :y1="geo.waterY"
      :x2="BOB_X"
      :y2="(edges[BAND] ?? 0) + 11"
      :stroke="INK"
      stroke-width="2"
      opacity="0.55"
    />
    <g :transform="`translate(${BOB_X} ${(edges[BAND] ?? 0) + 11})`">
      <path d="M -9 0 A 9 9 0 0 1 9 0 Z" :fill="CORAL" />
      <path d="M -9 0 A 9 9 0 0 0 9 0 Z" :fill="PAPER" />
      <circle cx="0" cy="0" r="9" fill="none" :stroke="INK" stroke-width="2.5" />
    </g>

    <!-- 손 높이 = 미끼 깊이. 위아래 잔상으로 "올렸다 내렸다 한다"를 보인다 -->
    <g v-for="(g, i) in GHOSTS" :key="i" :opacity="g.o">
      <FiHands :x="150" :y="g.y" :angle="-14" :scale="1.25" />
    </g>
    <FiHands :x="150" :y="176" :angle="-14" :scale="1.25" />
    <g fill="none" :stroke="INK" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M 70 176 L 70 150 M 63 158 L 70 150 L 77 158" />
      <path d="M 70 190 L 70 212 M 63 204 L 70 212 L 77 204" />
    </g>
  </FiStage>
</template>
