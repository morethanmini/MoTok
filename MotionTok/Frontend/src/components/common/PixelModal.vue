<script setup lang="ts">
/**
 * 픽셀 모달 오버레이. 배경 클릭 시 close 이벤트, 내부 클릭은 전파 차단.
 * <PixelModal @close="..."> ...내용... </PixelModal>
 */
defineEmits<{ close: [] }>()
</script>

<template>
  <div class="modal-wrap" @click="$emit('close')">
    <div class="modal" @click.stop>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.modal-wrap {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(56, 38, 61, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: px-pop 0.15s;
}
.modal {
  width: 390px;
  max-width: 92vw;
  padding: 24px;
  border: var(--border-thick);
  border-radius: var(--radius-xl);
  background: var(--c-paper);
  box-shadow: var(--shadow-xl);
}
</style>
