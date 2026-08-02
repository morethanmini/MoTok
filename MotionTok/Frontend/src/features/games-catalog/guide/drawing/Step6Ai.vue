<script setup lang="ts">
/** 6장 — 완성한 그림을 AI가 보고 무엇인지 맞힌다. 주제어를 맞히면 다 같이 점수. */
import { CAT_BODY, CAT_EYES, CAT_FACE, CAT_HEAD, GOLD, INK, catAt } from './art'
import DrStage from './DrStage.vue'

const TOPIC = '고양이'
</script>

<template>
  <DrStage :paper="false">
    <!-- 완성한 그림 — 3장의 머리에 몸통까지 붙었다 -->
    <rect x="18" y="40" width="150" height="140" rx="8" fill="rgba(90,72,50,0.16)" />
    <rect
      x="14"
      y="35"
      width="150"
      height="140"
      rx="8"
      fill="#fdfdf8"
      stroke="#d8cfbc"
      stroke-width="2"
    />
    <g
      :transform="catAt(89, 105, 0.9)"
      fill="none"
      :stroke="INK"
      stroke-width="4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path :d="CAT_HEAD" />
      <path :d="CAT_FACE" />
      <path :d="CAT_BODY" />
      <circle
        v-for="(e, i) in CAT_EYES"
        :key="i"
        :cx="e.x"
        :cy="e.y"
        r="3"
        :fill="INK"
        stroke="none"
      />
    </g>

    <!-- 그림을 들여다보는 AI -->
    <g>
      <rect
        x="196"
        y="34"
        width="76"
        height="60"
        rx="14"
        fill="#8fa6c9"
        :stroke="INK"
        stroke-width="3"
      />
      <circle cx="216" cy="60" r="8" fill="#fdfdf8" :stroke="INK" stroke-width="2.5" />
      <circle cx="252" cy="60" r="8" fill="#fdfdf8" :stroke="INK" stroke-width="2.5" />
      <circle cx="213" cy="61" r="3.5" :fill="INK" />
      <circle cx="249" cy="61" r="3.5" :fill="INK" />
      <path
        d="M 224 78 q 10 7 20 0"
        fill="none"
        :stroke="INK"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <!-- 안테나 -->
      <path d="M 234 34 L 234 22" :stroke="INK" stroke-width="3" stroke-linecap="round" />
      <circle cx="234" cy="19" r="5" :fill="GOLD" :stroke="INK" stroke-width="2.5" />
    </g>

    <!-- AI의 대답 — 주제어를 맞혔다 -->
    <g>
      <rect
        x="182"
        y="106"
        width="118"
        height="42"
        rx="12"
        :fill="GOLD"
        :stroke="INK"
        stroke-width="3"
      />
      <!-- 말풍선 꼬리 -->
      <path
        d="M 226 106 L 234 94 L 242 106 Z"
        :fill="GOLD"
        :stroke="INK"
        stroke-width="3"
        stroke-linejoin="round"
      />
      <text
        class="dr-guess"
        x="241"
        y="128"
        text-anchor="middle"
        dominant-baseline="central"
        :fill="INK"
      >
        {{ TOPIC }}!
      </text>
    </g>

    <!-- 맞혔다는 표시 -->
    <g>
      <circle cx="241" cy="172" r="17" fill="#7fbf6c" :stroke="INK" stroke-width="3" />
      <path
        d="M 233 172 l 5 6 l 11 -12"
        fill="none"
        :stroke="INK"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
  </DrStage>
</template>

<style scoped>
.dr-guess {
  font-family: var(--font-pixel), sans-serif;
  font-size: 21px;
}
</style>
