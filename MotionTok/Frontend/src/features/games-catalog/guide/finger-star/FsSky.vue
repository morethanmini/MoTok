<script setup lang="ts">
/**
 * 핑거 스타 안내 그림의 공통 무대 — 밤하늘 배경 + 잔별.
 * 그림 내용은 slot으로 받아 이 svg 안에 그대로 들어간다(SVG 자식이므로 HTML 태그는 넣지 말 것).
 */
import { SKY_TOP, SKY_BOTTOM, SPECKS, VIEW_H, VIEW_W } from './art'

defineProps<{
  /** 하늘 대신 밝은 배경을 쓰는 장(1장 "카메라 앞에서")에서 켠다. */
  daylight?: boolean
}>()

/** gradient id는 같은 문서에 여러 장이 동시에 있어도 겹치지 않게 장마다 다르게 준다. */
const uid = `fs-sky-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <svg class="fs-art" :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" role="img" aria-hidden="true">
    <defs>
      <linearGradient :id="uid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :stop-color="daylight ? '#ffe9c2' : SKY_TOP" />
        <stop offset="1" :stop-color="daylight ? '#ffd39b' : SKY_BOTTOM" />
      </linearGradient>
    </defs>

    <rect x="0" y="0" :width="VIEW_W" :height="VIEW_H" :fill="`url(#${uid})`" />

    <!-- 잔별 — 밝은 배경에선 눈에 띄지도 않고 의미도 없어서 뺀다 -->
    <g v-if="!daylight" fill="#ffffff">
      <circle
        v-for="(s, i) in SPECKS"
        :key="i"
        :cx="s.x"
        :cy="s.y"
        :r="s.r"
        :opacity="0.35 + (i % 3) * 0.2"
      />
    </g>

    <slot />
  </svg>
</template>

<style scoped>
.fs-art {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
