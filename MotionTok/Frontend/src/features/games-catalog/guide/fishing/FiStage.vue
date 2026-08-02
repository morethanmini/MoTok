<script setup lang="ts">
/**
 * 모션 낚시 안내 그림의 공통 무대.
 *
 * `split`이면 위는 낚시터, 아래는 내 손을 그리는 칸으로 나눈다(art.ts의 SPLIT 주석 참고).
 * 낚시터 좌표(수면·바닥·깊이 층)는 slot props로 내려 주므로, 각 장은 숫자를 다시 쓰지 않는다.
 */
import { computed } from 'vue'
import {
  BOAT,
  BOAT_RIM,
  FULL,
  SAND,
  SAND_DARK,
  SKY_BOT,
  SKY_TOP,
  SPLIT,
  VIEW_H,
  VIEW_W,
  WATER,
  bandEdges,
} from './art'

const props = withDefaults(
  defineProps<{
    /** 아래에 손 칸을 두고 낚시터를 위로 몰지. */
    split?: boolean
    /** 배를 그릴지. 물속만 보여 주는 장에서는 끈다. */
    boat?: boolean
    /** 깊이 층 경계선을 점선으로 보일지. */
    bands?: boolean
  }>(),
  { split: false, boat: true, bands: false },
)

const geo = computed(() => (props.split ? SPLIT : FULL))
const edges = computed(() => bandEdges(geo.value))
/** 낚시터가 끝나는 y — split이면 손 칸이 시작되는 자리. */
const bottom = computed(() => (props.split ? SPLIT.deckY : VIEW_H))

const uid = `fi-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <svg class="fi-art" :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" role="img" aria-hidden="true">
    <defs>
      <linearGradient :id="`${uid}-sky`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :stop-color="SKY_TOP" />
        <stop offset="1" :stop-color="SKY_BOT" />
      </linearGradient>
      <clipPath :id="`${uid}-lake`">
        <rect x="0" y="0" :width="VIEW_W" :height="bottom" />
      </clipPath>
    </defs>

    <g :clip-path="`url(#${uid}-lake)`">
      <rect x="0" y="0" :width="VIEW_W" :height="geo.waterY" :fill="`url(#${uid}-sky)`" />
      <rect
        v-for="(c, i) in WATER"
        :key="i"
        x="0"
        :y="edges[i]"
        :width="VIEW_W"
        :height="(edges[i + 1] ?? geo.sandY) - (edges[i] ?? 0)"
        :fill="c"
      />
      <template v-if="bands">
        <line
          v-for="(y, i) in edges.slice(1, 4)"
          :key="`b${i}`"
          x1="0"
          :y1="y"
          :x2="VIEW_W"
          :y2="y"
          stroke="rgba(255,255,255,0.4)"
          stroke-width="1.5"
          stroke-dasharray="6 6"
        />
      </template>
      <rect x="0" :y="geo.sandY" :width="VIEW_W" :height="bottom - geo.sandY" :fill="SAND" />
      <rect x="0" :y="bottom - 6" :width="VIEW_W" height="6" :fill="SAND_DARK" />
      <line
        x1="0"
        :y1="geo.waterY"
        :x2="VIEW_W"
        :y2="geo.waterY"
        stroke="#e2f7fe"
        stroke-width="3"
      />
      <g v-if="boat">
        <path
          :d="`M 12 ${geo.waterY - 14} L 82 ${geo.waterY - 14} L 73 ${geo.waterY + 2} L 21 ${geo.waterY + 2} Z`"
          :fill="BOAT"
          :stroke="BOAT_RIM"
          stroke-width="3"
          stroke-linejoin="round"
        />
      </g>
    </g>

    <!-- 내 손 칸 — 낚시터와 확실히 갈라 놓는다 -->
    <template v-if="split">
      <rect x="0" :y="SPLIT.deckY" :width="VIEW_W" :height="VIEW_H - SPLIT.deckY" fill="#fff3e2" />
      <line
        x1="0"
        :y1="SPLIT.deckY"
        :x2="VIEW_W"
        :y2="SPLIT.deckY"
        stroke="#d8bb97"
        stroke-width="3"
      />
    </template>

    <slot :geo="geo" :edges="edges" />
  </svg>
</template>

<style scoped>
.fi-art {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
