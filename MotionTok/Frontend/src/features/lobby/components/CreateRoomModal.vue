<script setup lang="ts">
/** 새 방 만들기 모달. 제목/공개설정/최대인원 입력 후 create. */
import { ref } from 'vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

export interface NewRoom {
  title: string
  visibility: string
  max: string
}

const emit = defineEmits<{ close: []; create: [payload: NewRoom] }>()

const title = ref('')
const visibility = ref('공개')
const max = ref('8')
</script>

<template>
  <PixelModal @close="emit('close')">
    <h3>새 게임방 만들기</h3>
    <p>친구들과 사용할 방 정보를 설정해 주세요.</p>
    <div class="form-grid">
      <label>
        방 제목
        <input v-model="title" placeholder="신나는 토요일 모션파티" />
      </label>
      <label>
        공개 설정
        <select v-model="visibility">
          <option value="공개">공개방</option>
          <option value="비밀">비밀방</option>
        </select>
      </label>
      <label>
        최대 인원
        <select v-model="max">
          <option value="2">2명</option>
          <option value="4">4명</option>
          <option value="6">6명</option>
          <option value="8">8명</option>
        </select>
      </label>
    </div>
    <div class="modal-actions">
      <PixelButton block @click="emit('close')">취소</PixelButton>
      <PixelButton
        variant="primary"
        block
        @click="emit('create', { title, visibility, max })"
      >
        방 만들기
      </PixelButton>
    </div>
  </PixelModal>
</template>

<style scoped>
h3 { margin: 0 0 7px; }
p { margin: 0 0 18px; color: var(--c-muted); font-size: 11px; }
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 11px;
}
.form-grid label {
  font-size: 9px;
  font-weight: 700;
}
.form-grid label:first-child { grid-column: 1 / -1; }
.form-grid input,
.form-grid select {
  width: 100%;
  height: 42px;
  margin-top: 6px;
  padding: 0 11px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: #fff;
}
.modal-actions {
  display: flex;
  gap: 9px;
  margin-top: 16px;
}
.modal-actions > * { flex: 1; }
</style>
