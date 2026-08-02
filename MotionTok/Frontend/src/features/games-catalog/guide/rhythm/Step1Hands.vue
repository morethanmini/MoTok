<script setup lang="ts">
/** 1장 — 두 손을 펴서 보여 주면 손마다 발바닥 커서가 붙는다. */
import { PAW_L, PAW_R, SKIN, SKIN_EDGE } from './art'
import RhPaw from './RhPaw.vue'
import RhStage from './RhStage.vue'

/** 손바닥 중심과 손끝 — finger-star와 같은 방식(굵은 둥근 선 두 겹)으로 그린다. */
const HANDS = [
  {
    palm: { x: 92, y: 186 },
    tips: [
      { x: 50, y: 176 },
      { x: 54, y: 142 },
      { x: 80, y: 118 },
      { x: 108, y: 136 },
      { x: 130, y: 162 },
    ],
    paw: PAW_L,
    letter: 'L',
  },
  {
    palm: { x: 228, y: 186 },
    tips: [
      { x: 270, y: 176 },
      { x: 266, y: 142 },
      { x: 240, y: 118 },
      { x: 212, y: 136 },
      { x: 190, y: 162 },
    ],
    paw: PAW_R,
    letter: 'R',
  },
]
</script>

<template>
  <RhStage>
    <g stroke-linecap="round">
      <g :stroke="SKIN_EDGE" :fill="SKIN_EDGE">
        <template v-for="(h, hi) in HANDS" :key="`e${hi}`">
          <line
            v-for="(t, i) in h.tips"
            :key="i"
            :x1="h.palm.x"
            :y1="h.palm.y"
            :x2="t.x"
            :y2="t.y"
            stroke-width="21"
          />
          <ellipse :cx="h.palm.x" :cy="h.palm.y" rx="29" ry="30" stroke="none" />
          <rect :x="h.palm.x - 19" :y="h.palm.y" width="38" height="40" rx="8" stroke="none" />
        </template>
      </g>
      <g :stroke="SKIN" :fill="SKIN">
        <template v-for="(h, hi) in HANDS" :key="`f${hi}`">
          <line
            v-for="(t, i) in h.tips"
            :key="i"
            :x1="h.palm.x"
            :y1="h.palm.y"
            :x2="t.x"
            :y2="t.y"
            stroke-width="15"
          />
          <ellipse :cx="h.palm.x" :cy="h.palm.y" rx="25" ry="26" stroke="none" />
          <rect :x="h.palm.x - 15" :y="h.palm.y" width="30" height="40" rx="6" stroke="none" />
        </template>
      </g>
    </g>

    <!-- 손바닥 위에 붙는 커서 — 이게 화면에서 나를 대신한다 -->
    <RhPaw
      v-for="(h, i) in HANDS"
      :key="i"
      :x="h.palm.x"
      :y="h.palm.y - 4"
      :size="46"
      :fill="h.paw.fill"
      :edge="h.paw.edge"
      :letter="h.letter"
    />
  </RhStage>
</template>
