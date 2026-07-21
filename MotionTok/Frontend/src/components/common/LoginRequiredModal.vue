<script setup lang="ts">
/** 멀티플레이 등 회원 전용 기능 진입 시 로그인을 유도하는 모달. */
import PixelModal from './PixelModal.vue'
import PixelButton from './PixelButton.vue'

withDefaults(
  defineProps<{ message?: string }>(),
  { message: '멀티 플레이는 로그인이 필요합니다.' },
)
defineEmits<{ close: []; login: [] }>()
</script>

<template>
  <PixelModal @close="$emit('close')">
    <div class="lr">
      <div class="icon">🔒</div>
      <h3>로그인이 필요해요</h3>
      <p>{{ message }}</p>
      <div class="actions">
        <PixelButton block @click="$emit('close')">취소</PixelButton>
        <PixelButton variant="primary" block @click="$emit('login')">로그인</PixelButton>
      </div>
    </div>
  </PixelModal>
</template>

<style scoped>
.lr { text-align: center; }
.icon { font-size: 40px; }
h3 { margin: 10px 0 8px; font-size: 16px; }
p { margin: 0 0 20px; font-size: 12px; color: var(--c-muted); line-height: 1.6; }
.actions { display: flex; gap: 9px; }
</style>
