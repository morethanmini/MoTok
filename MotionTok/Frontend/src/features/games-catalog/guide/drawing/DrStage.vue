<script setup lang="ts">
/**
 * 그림으로 말해요 안내 그림의 공통 무대 — 책상 + 도화지.
 * 그림 내용은 slot으로 받아 이 svg 안에 그대로 들어간다(SVG 자식이므로 HTML 태그 금지).
 */
import { DESK, PAPER, VIEW_H, VIEW_W } from './art'

withDefaults(
  defineProps<{
    /** 도화지를 깔지 여부. 손동작만 보여주는 장(4·5장)은 꺼서 화면을 비운다. */
    paper?: boolean
  }>(),
  { paper: true },
)

/** 도화지 자리 — 모든 장이 같은 위치를 써야 "같은 도화지"로 읽힌다. */
const SHEET = { x: 44, y: 30, w: 232, h: 160 }
defineExpose({ SHEET })
</script>

<template>
  <svg class="dr-art" :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" role="img" aria-hidden="true">
    <rect x="0" y="0" :width="VIEW_W" :height="VIEW_H" :fill="DESK" />

    <template v-if="paper">
      <!-- 종이 그림자 — 책상에 놓인 한 장으로 보이게 -->
      <rect
        :x="SHEET.x + 4"
        :y="SHEET.y + 5"
        :width="SHEET.w"
        :height="SHEET.h"
        rx="6"
        fill="rgba(90,72,50,0.16)"
      />
      <rect
        :x="SHEET.x"
        :y="SHEET.y"
        :width="SHEET.w"
        :height="SHEET.h"
        rx="6"
        :fill="PAPER"
        stroke="#d8cfbc"
        stroke-width="2"
      />
    </template>

    <slot :sheet="SHEET" />
  </svg>
</template>

<style scoped>
.dr-art {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
