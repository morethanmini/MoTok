<script setup lang="ts">
/**
 * 아래에서 위로 뻗은 두 손 (SVG 조각 — FsSky의 slot 안에 넣어 쓴다).
 *
 * 손가락은 "손바닥 중심 → 손끝(art.ts의 TIPS_*)"을 잇는 굵은 둥근 선이다. 손끝 좌표가
 * 곧 별 좌표라서 손을 그리기만 하면 별 위에 정확히 얹힌다.
 *
 * 테두리는 stroke를 따로 주지 않고 "굵은 어두운 선 → 가는 살색 선"을 겹쳐 낸다.
 * 손가락마다 stroke를 주면 손바닥과 만나는 자리에 선이 그어져 손이 조각나 보인다.
 */
import { PALM_L, PALM_R, SKIN, SKIN_EDGE, TIPS_L, TIPS_R, TIP_COLORS_L, TIP_COLORS_R } from './art'

withDefaults(
  defineProps<{
    /** 손끝에 게임과 같은 색 점을 찍는다. */
    showTips?: boolean
  }>(),
  { showTips: true },
)

const HANDS = [
  { palm: PALM_L, tips: TIPS_L, colors: TIP_COLORS_L },
  { palm: PALM_R, tips: TIPS_R, colors: TIP_COLORS_R },
]

const PALM_RX = 20
const PALM_RY = 21
/** 손목은 화면 아래로 그대로 빠져나간다 — 팔을 그리면 그림이 복잡해진다. */
const WRIST_W = 26
</script>

<template>
  <g>
    <!-- 1) 어두운 테두리 층 -->
    <g :stroke="SKIN_EDGE" :fill="SKIN_EDGE" stroke-linecap="round">
      <template v-for="(h, hi) in HANDS" :key="`e${hi}`">
        <line
          v-for="(t, i) in h.tips"
          :key="i"
          :x1="h.palm.x"
          :y1="h.palm.y"
          :x2="t.x"
          :y2="t.y"
          stroke-width="15"
        />
        <ellipse
          :cx="h.palm.x"
          :cy="h.palm.y"
          :rx="PALM_RX + 2.5"
          :ry="PALM_RY + 2.5"
          stroke="none"
        />
        <rect
          :x="h.palm.x - WRIST_W / 2 - 2.5"
          :y="h.palm.y"
          :width="WRIST_W + 5"
          height="60"
          rx="8"
          stroke="none"
        />
      </template>
    </g>

    <!-- 2) 살색 층 -->
    <g :stroke="SKIN" :fill="SKIN" stroke-linecap="round">
      <template v-for="(h, hi) in HANDS" :key="`f${hi}`">
        <line
          v-for="(t, i) in h.tips"
          :key="i"
          :x1="h.palm.x"
          :y1="h.palm.y"
          :x2="t.x"
          :y2="t.y"
          stroke-width="10"
        />
        <ellipse :cx="h.palm.x" :cy="h.palm.y" :rx="PALM_RX" :ry="PALM_RY" stroke="none" />
        <rect
          :x="h.palm.x - WRIST_W / 2"
          :y="h.palm.y"
          :width="WRIST_W"
          height="60"
          rx="6"
          stroke="none"
        />
      </template>
    </g>

    <!-- 3) 손끝 색 점 — 게임 화면에서 손가락마다 다른 색으로 보이는 그 점 -->
    <g v-if="showTips">
      <template v-for="(h, hi) in HANDS" :key="`t${hi}`">
        <circle v-for="(t, i) in h.tips" :key="i" :cx="t.x" :cy="t.y" r="4.2" :fill="h.colors[i]" />
      </template>
    </g>
  </g>
</template>
