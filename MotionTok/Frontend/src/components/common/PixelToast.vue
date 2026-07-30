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
  top: 50%;
  left: 50%;
  z-index: 300;
  transform: translate(-50%, -50%);
  padding: 12px 17px;
  background: rgba(56, 38, 61, .9);
  color: #fff;
  border-radius: var(--radius-md);
  font-size: 11px;
  box-shadow: none;
}
.toast-enter-active { animation: center-toast-pop 0.15s; }
.toast-leave-active { transition: opacity 0.2s; }
.toast-leave-to { opacity: 0; }
@keyframes center-toast-pop {
  from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)); }
  to { opacity: 1; transform: translate(-50%, -50%); }
}
</style>
