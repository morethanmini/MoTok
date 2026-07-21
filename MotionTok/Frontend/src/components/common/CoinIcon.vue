<script setup lang="ts">
/**
 * 코인 아이콘 (최초 버전 복원) — 금화 + 안쪽 링 + 반짝임 별 + 하이라이트.
 * ⚠️ 두 가지 필수 조건:
 *   1) 루트 클래스는 고유(.coin-icon) — 헤더의 `.coin` 알약과 겹치면 스타일이 덮어써짐.
 *   2) image-rendering:auto — 전역 `* { image-rendering: pixelated }`(base.css)로 인한 SVG 계단현상 방지.
 */
withDefaults(defineProps<{ size?: number }>(), { size: 16 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    shape-rendering="geometricPrecision"
    class="coin-icon"
    aria-hidden="true"
    focusable="false"
  >
    <!-- 코인 몸통 -->
    <circle cx="12" cy="12" r="10" fill="#ffc83d" stroke="#38263d" stroke-width="2" />
    <!-- 안쪽 링 -->
    <circle cx="12" cy="12" r="6.5" fill="none" stroke="#e0a01e" stroke-width="1.4" />
    <!-- 반짝임 별 -->
    <path
      d="M12 6 L13.4 10.6 L18 12 L13.4 13.4 L12 18 L10.6 13.4 L6 12 L10.6 10.6 Z"
      fill="#fff7d9"
      stroke="#e0a01e"
      stroke-width="0.6"
    />
    <!-- 하이라이트 -->
    <circle cx="8.6" cy="8.6" r="1.4" fill="#fff" opacity="0.75" />
  </svg>
</template>

<style scoped>
.coin-icon {
  display: inline-block;
  vertical-align: -0.18em;
  image-rendering: auto;
  filter: drop-shadow(1px 1px 0 rgba(56, 38, 61, 0.25));
  flex: none;
}
.coin-icon :deep(*) {
  image-rendering: auto;
}
</style>
