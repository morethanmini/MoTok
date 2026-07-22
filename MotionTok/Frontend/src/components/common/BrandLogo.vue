<script setup lang="ts">
/**
 * 브랜드 로고 — "M" 픽셀 마크 + 모션톡 타이틀.
 * subtitle 슬롯/prop으로 화면별 보조문구를 붙일 수 있습니다.
 */
withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    size?: 'sm' | 'md'
  }>(),
  { title: 'MoToK', subtitle: '', size: 'md' },
)
</script>

<template>
  <div class="brand" :class="`s-${size}`">
    <span class="px-mark mark">M</span>
    <div class="text">
      <div class="name">{{ title }}</div>
      <small v-if="subtitle" class="sub">{{ subtitle }}</small>
    </div>
  </div>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 4px;
}
.mark {
  transform: rotate(-2deg) translateX(-6px);
}
.text {
  text-align: left;
  transform: translateX(4px);
}
.s-md .mark { width: 47px; height: 47px; font-size: 24px; border-radius: 13px 13px 9px 13px; }
.s-sm .mark { width: 40px; height: 40px; font-size: 20px; border-radius: 11px; box-shadow: var(--shadow-sm); }
.name {
  font-weight: 700;
  letter-spacing: -1px;
}
.s-md .name { font-size: 19px; }
.s-sm .name { font-size: 15px; }
.sub {
  display: block;
  margin-top: 3px;
  color: var(--c-muted);
  font-size: 10px;
}
</style>
