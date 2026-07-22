<script setup lang="ts">
/** 닉네임으로 친구 요청 보내기 모달. */
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const target = defineModel<string>({ required: true })
const emit = defineEmits<{ close: []; send: [] }>()
</script>

<template>
  <PixelModal @close="emit('close')">
    <h3>친구 요청</h3>
    <p>닉네임으로 친구를 찾아 요청을 보내요.</p>
    <input v-model="target" placeholder="닉네임으로 친구 검색" @keydown.enter="emit('send')" />
    <div class="modal-actions">
      <PixelButton block @click="emit('close')">취소</PixelButton>
      <PixelButton variant="primary" block @click="emit('send')">요청 보내기</PixelButton>
    </div>
  </PixelModal>
</template>

<style scoped>
h3 { margin: 0 0 7px; }
p { margin: 0 0 18px; color: var(--c-muted); font-size: 11px; }
input {
  width: 100%;
  height: 46px;
  border: var(--border);
  border-radius: var(--radius-md);
  background: #fff;
  padding: 0 14px;
  outline: 0;
}
.modal-actions {
  display: flex;
  gap: 9px;
  margin-top: 16px;
}
.modal-actions > * { flex: 1; }
</style>
