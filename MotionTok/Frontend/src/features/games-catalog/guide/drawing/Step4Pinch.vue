<script setup lang="ts">
/**
 * 4장 — 오른손으로 OK 모양을 만들면 그려진다.
 *
 * 게임의 실제 판정은 엄지·검지 집기(logic.ts의 pinchRatio)지만, 그림으로는 <b>OK 모양</b>이
 * 훨씬 잘 통한다 — 나머지 세 손가락을 접은 "집기"는 주먹과 헷갈리는데, 셋을 펴 두면
 * 5장의 주먹과 한눈에 구별된다.
 *
 * <b>손 전체가 한 덩어리여야 한다.</b> 고리를 손바닥 옆에 따로 그리면 동그라미가 손에서
 * 떨어져 나온 것처럼 보인다(첫 시안이 그랬다). 그래서 손바닥·손가락·고리를 서로 겹치게
 * 그려 하나로 붙인 뒤, 고리 안쪽만 배경색으로 뚫는다 — OK 이모지와 같은 구성이다.
 *
 * 겹쳐 그리는 순서: 어두운 층(테두리) → 살색 층 → 구멍. 층마다 굵기 차이가 그대로 테두리가
 * 되므로 손가락마다 stroke를 주지 않아도 된다(그렇게 하면 손바닥과 만나는 자리에 선이 그어진다).
 */
import { INK, PEN_CURSOR, SKIN, SKIN_EDGE } from './art'
import DrStage from './DrStage.vue'
import DrToolBadge from './DrToolBadge.vue'

/**
 * 고리는 손바닥 <b>속으로 깊이</b> 들어가 있다 — 바깥 오른쪽(180)이 손바닥 왼쪽(148)을
 * 32px 넘어선다. 손 옆에 살짝 닿아 있으면 아무리 붙여도 "도넛과 손"으로 보인다.
 * 이모지처럼 고리의 오른쪽 절반이 손에 파묻혀야 한 덩어리로 읽힌다.
 *
 * <b>구멍을 맨 마지막에 뚫기 때문에</b> 이렇게까지 밀어 넣을 수 있다. 구멍은 손바닥 위에도
 * 그대로 뚫리므로, 겹침을 늘리려다 구멍이 막히는 문제가 없다(예전에는 구멍과 손바닥이
 * 서로 자리를 뺏는 관계라 겹침을 12px밖에 못 줬다).
 *
 * 대신 구멍이 손바닥을 파고든 쪽에는 고리 띠의 테두리가 없어서, 뚫을 때 테두리를 함께 그린다.
 */
const PALM = { x: 186, y: 136, rx: 38, ry: 42 }
const RING = { x: 136, y: 140, r: 32 }
/** 펴 둔 세 손가락 — 중지가 가장 길다. */
const UP_FINGERS = [
  { x: 176, y: 46 },
  { x: 212, y: 58 },
  { x: 234, y: 94 },
]
/** 두 손끝이 맞닿는 자리 = 펜 끝. 고리 띠 위(왼쪽 아래)에 얹는다. */
const TIP = { x: RING.x - RING.r, y: RING.y + 11 }

/** 어두운 층 / 살색 층의 굵기. 차이가 테두리 두께이자 고리 안쪽 테두리가 된다. */
const EDGE_W = 30
const SKIN_W = 24
/** 테두리 여유 — 모든 부위에 같은 값을 써야 테두리 굵기가 고르다. */
const EDGE_PAD = 4
</script>

<template>
  <DrStage :paper="true">
    <!-- 방금 그려진 선 — 맞닿은 손끝에서 이어져 나온다 -->
    <path
      :d="`M 56 190 Q 58 150 ${TIP.x} ${TIP.y}`"
      fill="none"
      :stroke="INK"
      stroke-width="5"
      stroke-linecap="round"
    />

    <g stroke-linecap="round">
      <!--
        어두운 층 → 살색 층 순서로 같은 모양을 두 번 그린다. 층 안에서는 <b>고리 → 손가락 →
        손바닥</b> 순이라, 나중에 오는 손바닥이 고리·손가락과 만나는 이음매를 덮는다.
        (손바닥을 먼저 그리면 고리가 손바닥 위에 얹혀 경계선이 그대로 보인다)
      -->
      <g :stroke="SKIN_EDGE" :fill="SKIN_EDGE">
        <circle :cx="RING.x" :cy="RING.y" :r="RING.r" fill="none" :stroke-width="EDGE_W" />
        <line
          v-for="(f, i) in UP_FINGERS"
          :key="i"
          :x1="PALM.x"
          :y1="PALM.y"
          :x2="f.x"
          :y2="f.y"
          :stroke-width="20 + EDGE_PAD * 2"
        />
        <ellipse
          :cx="PALM.x"
          :cy="PALM.y"
          :rx="PALM.rx + EDGE_PAD"
          :ry="PALM.ry + EDGE_PAD"
          stroke="none"
        />
        <rect
          :x="PALM.x - 22 - EDGE_PAD"
          :y="PALM.y"
          :width="44 + EDGE_PAD * 2"
          height="70"
          rx="12"
          stroke="none"
        />
      </g>
      <g :stroke="SKIN" :fill="SKIN">
        <circle :cx="RING.x" :cy="RING.y" :r="RING.r" fill="none" :stroke-width="SKIN_W" />
        <line
          v-for="(f, i) in UP_FINGERS"
          :key="i"
          :x1="PALM.x"
          :y1="PALM.y"
          :x2="f.x"
          :y2="f.y"
          stroke-width="20"
        />
        <ellipse :cx="PALM.x" :cy="PALM.y" :rx="PALM.rx" :ry="PALM.ry" stroke="none" />
        <rect :x="PALM.x - 22" :y="PALM.y" width="44" height="70" rx="10" stroke="none" />
      </g>
      <!--
        고리 안쪽을 뚫는다 — 도화지가 그대로 비쳐야 "동그라미"로 보인다.
        테두리를 같이 그리는 이유: 구멍이 손바닥까지 파고들어서, 그쪽엔 고리 띠의 테두리가
        없다(고리를 손바닥이 덮었으므로). 안 그리면 구멍의 오른쪽만 윤곽 없이 끊겨 보인다.
      -->
      <circle
        :cx="RING.x"
        :cy="RING.y"
        :r="RING.r - SKIN_W / 2"
        fill="#fdfdf8"
        :stroke="SKIN_EDGE"
        stroke-width="4"
      />
      <!-- 엄지와 검지가 맞닿은 자리 — 고리 띠를 가로지르는 짧은 금 -->
      <path
        :d="`M ${TIP.x + 2} ${TIP.y - 13} l 12 5`"
        fill="none"
        :stroke="SKIN_EDGE"
        stroke-width="2.5"
        stroke-linecap="round"
        opacity="0.6"
      />
    </g>

    <circle :cx="TIP.x" :cy="TIP.y" r="9" :fill="PEN_CURSOR" stroke="#fffaf0" stroke-width="3" />

    <!-- 이 손 모양이 연필이 된다 -->
    <DrToolBadge tool="pencil" :x="264" :y="182" />
  </DrStage>
</template>
