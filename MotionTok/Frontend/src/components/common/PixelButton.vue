<script setup lang="ts">
/**
 * 공통 픽셀 버튼. 화면마다 재정의하지 말고 variant/size 조합으로 사용하세요.
 * 예: <PixelButton variant="primary" @click="...">로그인</PixelButton>
 */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'guest' | 'yellow' | 'mint' | 'ghost'
    size?: 'md' | 'lg'
    block?: boolean
    disabled?: boolean
  }>(),
  { variant: 'secondary', size: 'md', block: false, disabled: false },
)
</script>

<template>
  <button
    class="px-btn"
    :class="[`v-${variant}`, `s-${size}`, { block }]"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.px-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: var(--border);
  border-radius: 15px 15px 11px 15px;
  background: #fff;
  box-shadow: var(--shadow-md);
  font-weight: 700;
  white-space: nowrap;
  transition: var(--t-fast);
}
.px-btn:hover:not(:disabled) {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-lg);
  filter: saturate(1.08);
}
.px-btn:active:not(:disabled) {
  transform: translate(2px, 2px);
  box-shadow: var(--shadow-sm);
}
.px-btn:disabled {
  background: #cfc7cb;
  color: #877d84;
  box-shadow: var(--shadow-sm);
  cursor: not-allowed;
}

/* sizes */
.s-md { height: 43px; padding: 0 18px; font-size: 13px; }
.s-lg { height: 49px; padding: 0 22px; font-size: 14px; }
.block { width: 100%; }

/* variants */
.v-primary { background: var(--c-coral); color: #fff; }
.v-secondary { background: #fff; }
.v-guest { background: var(--c-mint-soft); }
.v-yellow { background: var(--c-yellow); }
.v-mint { background: var(--c-mint); color: #fff; }
.v-ghost {
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--c-blue);
}
.v-ghost:hover:not(:disabled) {
  transform: none;
  box-shadow: none;
}
</style>
