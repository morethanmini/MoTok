<script setup lang="ts">
/** 5장 — 60초 동안 별자리를 많이 완성할수록 이긴다. */
import { GOLD, LINE, STARS, STARS_B, STAR_PATH, STAR_PATH_B, TIMER, fitMini, star5 } from './art'
import FsSky from './FsSky.vue'

const MATCH_SECONDS = 60
const CARD = { y: 92, w: 62, h: 62 }
/** 카드 안에서 별자리가 차지할 크기(px). 모양이 달라도 이 크기로 맞춰 그린다. */
const MINI_SIZE = 46
/** 축소해도 별·선이 이만큼은 보이게 — 배율로 나눠 화면 기준 굵기로 되돌린다. */
const MINI_STAR_PX = 4.4
const MINI_LINE_PX = 2

/**
 * 완성 카드 3장 — 2장은 다 만들었고 1장은 아직. "많이 만들수록"이 개수로 보인다.
 * 두 번째는 다른 별자리다: 판마다 다른 별자리가 나오는 게임이라 같은 모양이 반복되면
 * 여러 개를 완성했다는 게 안 읽힌다.
 */
const CARDS = [
  { x: 22, done: true, stars: STARS, path: STAR_PATH },
  { x: 94, done: true, stars: STARS_B, path: STAR_PATH_B },
  { x: 166, done: false, stars: STARS, path: STAR_PATH },
].map((card) => ({
  ...card,
  mini: fitMini(card.stars, card.x + CARD.w / 2, CARD.y + CARD.h / 2 - 4, MINI_SIZE),
}))
</script>

<template>
  <FsSky>
    <!-- 남은 시간 -->
    <g>
      <rect
        x="20"
        y="20"
        width="104"
        height="34"
        rx="17"
        fill="rgba(255,255,255,0.12)"
        :stroke="TIMER"
        stroke-width="3"
      />
      <circle cx="41" cy="37" r="9" fill="none" :stroke="TIMER" stroke-width="3" />
      <path
        d="M 41 32 L 41 37 L 45 39"
        fill="none"
        :stroke="TIMER"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <text class="fs-num fs-time" x="60" y="38" dominant-baseline="central" :fill="TIMER">
        {{ MATCH_SECONDS }}초
      </text>
    </g>

    <!-- 완성한 별자리들 -->
    <g v-for="(c, i) in CARDS" :key="i">
      <rect
        :x="c.x"
        :y="CARD.y"
        :width="CARD.w"
        :height="CARD.h"
        rx="10"
        :fill="c.done ? 'rgba(255,210,63,0.16)' : 'rgba(255,255,255,0.06)'"
        :stroke="c.done ? GOLD : 'rgba(255,255,255,0.35)'"
        stroke-width="3"
      />
      <g :transform="c.mini.transform">
        <path
          :d="c.path"
          fill="none"
          :stroke="c.done ? GOLD : 'rgba(255,255,255,0.3)'"
          :stroke-width="MINI_LINE_PX / c.mini.scale"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          v-for="(s, si) in c.stars"
          :key="si"
          :d="star5(s.x, s.y, MINI_STAR_PX / c.mini.scale)"
          :fill="c.done ? GOLD : 'rgba(255,255,255,0.3)'"
        />
      </g>
      <!-- 완성 표시 -->
      <g v-if="c.done">
        <circle :cx="c.x + CARD.w - 8" :cy="CARD.y + CARD.h - 8" r="11" :fill="LINE" />
        <path
          :d="`M ${c.x + CARD.w - 13} ${CARD.y + CARD.h - 8} l 3.5 4 l 6.5 -7.5`"
          fill="none"
          stroke="#14300a"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </g>
      <text
        v-else
        class="fs-num fs-next"
        :x="c.x + CARD.w / 2"
        :y="CARD.y + CARD.h - 12"
        text-anchor="middle"
        fill="rgba(255,255,255,0.55)"
      >
        ?
      </text>
    </g>

    <!-- 1등 트로피 -->
    <g>
      <path
        d="M 252 96 h 40 v 16 a 20 20 0 0 1 -40 0 Z"
        :fill="GOLD"
        stroke="#8d5c38"
        stroke-width="3"
      />
      <path d="M 250 98 a 10 10 0 0 1 0 18" fill="none" stroke="#8d5c38" stroke-width="3" />
      <path d="M 294 98 a 10 10 0 0 0 0 18" fill="none" stroke="#8d5c38" stroke-width="3" />
      <rect x="266" y="130" width="12" height="12" :fill="GOLD" stroke="#8d5c38" stroke-width="3" />
      <rect
        x="254"
        y="140"
        width="36"
        height="12"
        rx="4"
        :fill="GOLD"
        stroke="#8d5c38"
        stroke-width="3"
      />
      <text
        class="fs-num fs-rank"
        x="272"
        y="112"
        text-anchor="middle"
        dominant-baseline="central"
        fill="#8d5c38"
      >
        1
      </text>
    </g>

    <!-- 축하 반짝임 -->
    <g :fill="GOLD" opacity="0.9">
      <path :d="star5(240, 74, 7)" />
      <path :d="star5(300, 78, 5)" />
      <path :d="star5(160, 176, 6)" />
    </g>
  </FsSky>
</template>

<style scoped>
.fs-num {
  font-family: var(--font-pixel), sans-serif;
}
.fs-time {
  font-size: 17px;
}
.fs-next {
  font-size: 20px;
}
.fs-rank {
  font-size: 18px;
}
</style>
