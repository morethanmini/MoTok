<script setup lang="ts">
/** 5장 — 주먹을 쥐고 문지르면 지워진다. */
import { ERASER, INK, SKIN, SKIN_EDGE } from './art'
import DrStage from './DrStage.vue'
import DrToolBadge from './DrToolBadge.vue'

const FIST = { x: 178, y: 132 }
/**
 * 앞으로 감싼 엄지 — 오른쪽 옆면. 주먹 몸통(오른쪽 끝 x=220) 밖으로 8px쯤 나온다.
 * 안 나오면 둥근 모서리와 구별되지 않고, 너무 나오면 엄지가 손보다 커 보인다.
 *
 * 어느 쪽에 그리느냐가 어느 손인지를 정한다 — 손등 쪽에서 본 주먹은 엄지가 오른쪽에 보이면
 * 왼손이다. "왼손 주먹"이라고 써 놓고 왼쪽에 그리면 글과 그림이 서로 다른 손을 가리킨다.
 */
const THUMB = `M ${FIST.x + 32} ${FIST.y - 10} q 19 18 -10 34`
</script>

<template>
  <DrStage :paper="true">
    <!-- 지워지는 중인 선 — 주먹이 지나간 오른쪽이 사라져 있다 -->
    <path
      d="M 66 158 Q 96 108 132 128"
      fill="none"
      :stroke="INK"
      stroke-width="5"
      stroke-linecap="round"
    />
    <path
      d="M 132 128 Q 168 148 214 116"
      fill="none"
      :stroke="INK"
      stroke-width="5"
      stroke-linecap="round"
      stroke-dasharray="3 12"
      opacity="0.28"
    />

    <!-- 지우개가 닿는 자리 -->
    <circle :cx="FIST.x" :cy="FIST.y" r="46" :fill="ERASER" opacity="0.16" />

    <!--
      주먹: 손가락을 접었으므로 손끝이 없다 — 넓적한 덩어리 위에 마디 네 개가 튀어나온 모양.

      엄지는 <b>주먹 뒤에</b> 깔고 옆으로 튀어나온 부분만 보이게 한다(살색 층에서 몸통보다
      먼저 그린다). 몸통 위에 얹으면 엄지의 테두리가 주먹을 가로질러서 따로 붙인 것처럼 보인다.
      앞을 가로지르게 그리지 않는 이유는 따로 있다 — 가로로 그으면 입처럼 보여서 주먹이 아니라
      얼굴로 읽힌다(첫 시안이 그랬다).
    -->
    <g>
      <!-- 어두운 층 -->
      <circle
        v-for="i in 4"
        :key="`e${i}`"
        :cx="FIST.x - 30 + (i - 1) * 20"
        :cy="FIST.y - 26"
        r="13"
        :fill="SKIN_EDGE"
      />
      <path :d="THUMB" fill="none" :stroke="SKIN_EDGE" stroke-width="22" stroke-linecap="round" />
      <rect :x="FIST.x - 46" :y="FIST.y - 30" width="92" height="70" rx="18" :fill="SKIN_EDGE" />
      <rect :x="FIST.x - 20" :y="FIST.y + 30" width="40" height="64" rx="10" :fill="SKIN_EDGE" />

      <!-- 살색 층 — 엄지가 몸통보다 먼저라 겹친 부분은 몸통이 덮는다 -->
      <path :d="THUMB" fill="none" :stroke="SKIN" stroke-width="16" stroke-linecap="round" />
      <rect :x="FIST.x - 42" :y="FIST.y - 26" width="84" height="62" rx="15" :fill="SKIN" />
      <circle
        v-for="i in 4"
        :key="i"
        :cx="FIST.x - 30 + (i - 1) * 20"
        :cy="FIST.y - 26"
        r="9.5"
        :fill="SKIN"
      />
      <rect :x="FIST.x - 16" :y="FIST.y + 30" width="32" height="64" rx="8" :fill="SKIN" />

      <!-- 마디 사이 골 — 손가락 네 개를 접었다는 단서 -->
      <g :stroke="SKIN_EDGE" stroke-width="2" stroke-linecap="round" opacity="0.5">
        <line
          v-for="i in 3"
          :key="i"
          :x1="FIST.x - 20 + (i - 1) * 20"
          :y1="FIST.y - 30"
          :x2="FIST.x - 20 + (i - 1) * 20"
          :y2="FIST.y - 8"
        />
      </g>
    </g>

    <!-- 문지른다는 표시 — 좌우로 오가는 선 -->
    <g :stroke="ERASER" stroke-width="3.5" stroke-linecap="round" fill="none">
      <path
        :d="`M ${FIST.x - 62} ${FIST.y - 6} l -14 0 M ${FIST.x - 70} ${FIST.y - 11} l -6 5 l 6 5`"
      />
      <path
        :d="`M ${FIST.x + 62} ${FIST.y - 6} l 14 0 M ${FIST.x + 70} ${FIST.y - 11} l 6 5 l -6 5`"
      />
    </g>

    <!-- 이 손 모양이 지우개가 된다 -->
    <DrToolBadge tool="eraser" :x="246" :y="62" />
  </DrStage>
</template>
