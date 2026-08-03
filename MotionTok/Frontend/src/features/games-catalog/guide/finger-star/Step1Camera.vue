<script setup lang="ts">
/** 1장 — 카메라 앞에서 두 손을 쫙 편다. */
import { SKIN, SKIN_EDGE, LINE } from './art'
import FsSky from './FsSky.vue'

/** 화면 속 아이의 손: 손바닥에서 부채꼴로 뻗은 손가락 5개(각도·길이 고정). */
const FAN = [
  { dx: -13.2, dy: -4.8 },
  { dx: -9.0, dy: -10.7 },
  { dx: -2.4, dy: -13.8 },
  { dx: 4.8, dy: -13.2 },
  { dx: 10.7, dy: -9.0 },
]
const KID_HANDS = [
  { x: 124, y: 78 },
  { x: 196, y: 78 },
]
</script>

<template>
  <FsSky daylight>
    <!-- 모니터 -->
    <rect
      x="46"
      y="26"
      width="228"
      height="152"
      rx="12"
      fill="#fff6e2"
      stroke="#8d5c38"
      stroke-width="4"
    />
    <!-- 카메라 렌즈 — "여기서 나를 본다"를 알려주는 유일한 단서라 크게 그린다 -->
    <circle cx="160" cy="37" r="5" fill="#3e2e24" />
    <circle cx="160" cy="37" r="2" fill="#ff8f8f" />
    <rect x="58" y="48" width="204" height="118" rx="6" fill="#182a55" />

    <!-- 화면 속 아이 -->
    <g stroke-linecap="round">
      <!-- 팔: 어두운 선 → 살색 선 순서로 겹쳐 테두리를 낸다(FsHands와 같은 방식) -->
      <g :stroke="SKIN_EDGE" stroke-width="14">
        <line x1="143" y1="120" x2="124" y2="80" />
        <line x1="177" y1="120" x2="196" y2="80" />
      </g>
      <path d="M 138 122 Q 160 110 182 122 L 188 166 L 132 166 Z" fill="#7a4f2e" />
      <g :stroke="SKIN" stroke-width="9">
        <line x1="143" y1="120" x2="124" y2="80" />
        <line x1="177" y1="120" x2="196" y2="80" />
      </g>
      <path d="M 140 124 Q 160 113 180 124 L 185 166 L 135 166 Z" :fill="LINE" />

      <!-- 활짝 편 두 손 -->
      <template v-for="(h, hi) in KID_HANDS" :key="hi">
        <g :stroke="SKIN_EDGE" stroke-width="9">
          <line
            v-for="(f, i) in FAN"
            :key="i"
            :x1="h.x"
            :y1="h.y"
            :x2="h.x + f.dx"
            :y2="h.y + f.dy"
          />
        </g>
        <circle :cx="h.x" :cy="h.y" r="10.5" :fill="SKIN_EDGE" />
        <g :stroke="SKIN" stroke-width="5">
          <line
            v-for="(f, i) in FAN"
            :key="i"
            :x1="h.x"
            :y1="h.y"
            :x2="h.x + f.dx"
            :y2="h.y + f.dy"
          />
        </g>
        <circle :cx="h.x" :cy="h.y" r="7.5" :fill="SKIN" />
      </template>

      <!-- 머리 -->
      <circle cx="160" cy="98" r="17" :fill="SKIN_EDGE" />
      <circle cx="160" cy="98" r="14.5" :fill="SKIN" />
      <path d="M 146 92 Q 160 78 174 92 Q 160 87 146 92 Z" fill="#5a3a24" />
      <circle cx="154" cy="99" r="2.2" fill="#3e2e24" />
      <circle cx="166" cy="99" r="2.2" fill="#3e2e24" />
      <path d="M 154 105 Q 160 110 166 105" stroke="#3e2e24" stroke-width="2" fill="none" />
    </g>

    <!-- 손이 바깥으로 펴진다는 표시 -->
    <g stroke="#ffffff" stroke-width="2.5" fill="none" opacity="0.75" stroke-linecap="round">
      <path d="M 106 66 Q 100 74 102 84" />
      <path d="M 214 66 Q 220 74 218 84" />
    </g>

    <!-- 받침대 -->
    <path
      d="M 132 178 L 188 178 L 196 194 L 124 194 Z"
      fill="#e8d3ae"
      stroke="#8d5c38"
      stroke-width="4"
    />
    <rect
      x="104"
      y="192"
      width="112"
      height="12"
      rx="6"
      fill="#fff6e2"
      stroke="#8d5c38"
      stroke-width="4"
    />
  </FsSky>
</template>
