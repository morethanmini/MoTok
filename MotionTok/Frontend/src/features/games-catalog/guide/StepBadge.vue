<script setup lang="ts">
/**
 * 그림이 아직 없는 게임의 대체 슬라이드 — 게임 이모지 + 단계 번호.
 *
 * 문장은 캐러셀 캡션이 이미 보여주므로 여기서 또 쓰지 않는다(같은 글이 두 번 나오면
 * 읽는 사람이 둘을 비교하게 된다). 이 자리는 "몇 번째 단계인가"만 말한다.
 * 게임마다 그림 5장을 그려 등록하면 이 컴포넌트는 그 게임에서 더 이상 쓰이지 않는다.
 */
defineProps<{ emoji: string; step: number }>()
</script>

<template>
  <svg class="sb" viewBox="0 0 320 220" role="img" aria-hidden="true">
    <defs>
      <linearGradient id="sb-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff3d8" />
        <stop offset="1" stop-color="#ffe3bb" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="320" height="220" fill="url(#sb-bg)" />

    <!-- 진행 표시는 넣지 않는다 — 캐러셀이 이미 점과 "n / m"으로 같은 걸 말한다 -->
    <circle cx="160" cy="110" r="58" fill="#fffaf0" stroke="#d7b280" stroke-width="4" />
    <text x="160" y="118" text-anchor="middle" dominant-baseline="central" font-size="58">
      {{ emoji }}
    </text>

    <circle cx="112" cy="66" r="20" fill="#e8905f" stroke="#fffaf0" stroke-width="4" />
    <text
      class="sb-step"
      x="112"
      y="67"
      text-anchor="middle"
      dominant-baseline="central"
      fill="#fffaf0"
    >
      {{ step }}
    </text>
  </svg>
</template>

<style scoped>
.sb {
  display: block;
  width: 100%;
  height: 100%;
}
.sb-step {
  font-family: var(--font-pixel), sans-serif;
  font-size: 19px;
}
</style>
