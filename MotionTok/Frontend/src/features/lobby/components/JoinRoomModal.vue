<script setup lang="ts">
/** 방 코드로 참가 모달. 6자리 코드 입력 후 join. */
import { ref } from 'vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const emit = defineEmits<{ close: []; join: [code: string] }>()

const code = ref('')
const onInput = (e: Event) => {
  code.value = (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
</script>

<template>
  <PixelModal @close="emit('close')">
    <h3>방 코드로 참가</h3>
    <p>친구에게 받은 6자리 코드를 입력해 주세요.</p>
    <input :value="code" placeholder="예: MP4X9K" maxlength="6" @input="onInput" />
    <div class="modal-actions">
      <PixelButton block @click="emit('close')">취소</PixelButton>
      <PixelButton variant="primary" block @click="emit('join', code)">참가하기</PixelButton>
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
  text-transform: uppercase;
}
.modal-actions {
  display: flex;
  gap: 9px;
  margin-top: 16px;
}
.modal-actions > * { flex: 1; }
</style>
