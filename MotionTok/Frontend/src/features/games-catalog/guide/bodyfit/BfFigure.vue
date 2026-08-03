<script setup lang="ts">
/**
 * 포즈를 취한 사람 (SVG 조각). 굵은 둥근 선 = 팔다리, 원 = 머리.
 *
 * 같은 컴포넌트로 <b>아바타</b>도 그리고 <b>벽 구멍</b>도 뚫는다 — 구멍은 이 모양을 더 굵게
 * 그린 것뿐이다(실제 게임도 목표 실루엣을 1.45~1.9배로 부풀려 구멍을 만든다).
 * 그래서 같은 포즈를 주면 사람이 구멍에 정확히 들어간다.
 */
import { computed } from 'vue'
import { armPoints, type Pose } from './art'

const props = withDefaults(
  defineProps<{
    x: number
    /** 어깨 높이. 머리는 이 위, 다리는 아래로 뻗는다. */
    y: number
    pose: Pose
    /** 몸 크기 배율(1 = 기준). */
    scale?: number
    color: string
    /** 굵기를 얼마나 부풀릴지 — 벽 "구멍"으로 쓸 때만 준다. 사람일 때는 0. */
    bloat?: number
    /** 삐져나온 팔에 칠할 색. overflowArm과 함께 쓴다. */
    overflowColor?: string
    /** 어느 팔이 삐져나왔는지. */
    overflowArm?: 'L' | 'R' | null
  }>(),
  { scale: 1, bloat: 0, overflowColor: '', overflowArm: null },
)

/** 기준 치수(scale = 1). */
const UPPER = 26
const FORE = 24
const LIMB = 15
const HEAD = 13
const TORSO = 40
const LEG = 34

const s = computed(() => props.scale)
const width = computed(() => LIMB * s.value + props.bloat)
/** 어깨 — 팔이 시작하는 점. */
const shoulder = computed(() => ({ x: props.x, y: props.y + 4 * s.value }))

const arms = computed(() =>
  (['L', 'R'] as const).map((side) => ({
    side,
    color: props.overflowArm === side && props.overflowColor ? props.overflowColor : props.color,
    ...armPoints(
      shoulder.value,
      side === 'L' ? props.pose.armL : props.pose.armR,
      side === 'L' ? -1 : 1,
      UPPER * s.value,
      FORE * s.value,
    ),
  })),
)

const legs = computed(() => {
  const rad = (props.pose.legs * Math.PI) / 180
  const hip = { x: props.x, y: props.y + TORSO * s.value }
  return [-1, 1].map((d) => ({
    hip,
    foot: {
      x: hip.x + d * LEG * s.value * Math.sin(rad),
      y: hip.y + LEG * s.value * Math.cos(rad),
    },
  }))
})
</script>

<template>
  <g stroke-linecap="round" :stroke="color" :fill="color">
    <!-- 몸통 -->
    <line :x1="x" :y1="y" :x2="x" :y2="y + TORSO * s" :stroke-width="(LIMB + 6) * s + bloat" />
    <circle :cx="x" :cy="y - (HEAD + 5) * s" :r="HEAD * s + bloat / 2" stroke="none" />

    <line
      v-for="(l, i) in legs"
      :key="i"
      :x1="l.hip.x"
      :y1="l.hip.y"
      :x2="l.foot.x"
      :y2="l.foot.y"
      :stroke-width="width"
    />

    <!-- 팔 — 위팔·아래팔을 나눠 그려 팔꿈치가 접힌다 -->
    <g v-for="a in arms" :key="a.side" :stroke="a.color">
      <line
        :x1="shoulder.x"
        :y1="shoulder.y"
        :x2="a.elbow.x"
        :y2="a.elbow.y"
        :stroke-width="width"
      />
      <line :x1="a.elbow.x" :y1="a.elbow.y" :x2="a.hand.x" :y2="a.hand.y" :stroke-width="width" />
    </g>
  </g>
</template>
