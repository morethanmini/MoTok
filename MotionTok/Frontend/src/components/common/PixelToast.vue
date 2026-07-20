<script setup lang="ts">
/** 화면 하단 중앙 토스트. useToast()의 message를 넘겨 사용. */
defineProps<{ message: string }>()
</script>

<template>
  <Transition name="toast">
    <div v-if="message" class="toast">{{ message }}</div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  bottom: 30px;
  z-index: 300;
  transform: translateX(-50%);
  padding: 12px 17px;
  background: var(--c-ink);
  color: #fff;
  border-radius: var(--radius-md);
  font-size: 11px;
  box-shadow: 4px 4px 0 var(--c-yellow);
}
.toast-enter-active { animation: px-pop 0.15s; }
.toast-leave-active { transition: opacity 0.2s; }
.toast-leave-to { opacity: 0; }
</style>
