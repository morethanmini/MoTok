<script setup lang="ts">
/** 픽셀 카드 컨테이너. 제목(선택) + 내용 슬롯. */
withDefaults(defineProps<{ title?: string; pad?: string }>(), { title: '', pad: '20px' })
</script>

<template>
  <section class="card" :style="{ padding: pad }">
    <header v-if="title || $slots.head" class="card-head">
      <h2 v-if="title">{{ title }}</h2>
      <slot name="head" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.card {
  border: var(--border);
  border-radius: 19px 19px 14px 19px;
  background: #fff;
  box-shadow: var(--shadow-lg);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.card-head h2 { margin: 0; font-size: 15px; }
</style>
