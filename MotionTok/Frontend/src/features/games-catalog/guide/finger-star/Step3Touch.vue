<script setup lang="ts">
/** 3장 — 손가락 끝을 별 위에 올린다. 별이 손끝 좌표라 손을 그리면 저절로 맞물린다. */
import { LINE, STARS, STAR_PATH, STAR_R, star5 } from './art'
import FsHands from './FsHands.vue'
import FsSky from './FsSky.vue'
</script>

<template>
  <FsSky>
    <path
      :d="STAR_PATH"
      fill="none"
      :stroke="LINE"
      stroke-width="3"
      stroke-linecap="round"
      opacity="0.9"
    />

    <!-- 켜진 별 — 2장의 빈 별과 달리 하얗게 차 있다.
         손이 위에 올라가므로 별을 조금 키워 손가락 뒤로 숨지 않게 한다. -->
    <g>
      <circle
        v-for="(s, i) in STARS"
        :key="`g${i}`"
        :cx="s.x"
        :cy="s.y"
        r="14"
        fill="#ffffff"
        opacity="0.13"
      />
      <path
        v-for="(s, i) in STARS"
        :key="i"
        :d="star5(s.x, s.y, STAR_R + 2)"
        fill="#ffffff"
        :stroke="LINE"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </g>

    <FsHands />
  </FsSky>
</template>
