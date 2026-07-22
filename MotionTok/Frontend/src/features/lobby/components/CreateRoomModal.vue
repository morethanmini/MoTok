<script setup lang="ts">
/** 새 방 만들기 모달. 제목/공개설정/최대인원 입력 후 create. */
import { nextTick, ref } from 'vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

export interface NewRoom {
  title: string
  visibility: string
  max: string
  password?: string
}

const emit = defineEmits<{ close: []; create: [payload: NewRoom] }>()

const title = ref('')
const visibility = ref('공개')
const password = ref('')
function onPasswordInput(e: Event) {
  const input = e.target as HTMLInputElement
  password.value = input.value.replace(/[^0-9]/g, '').slice(0, 6)
}

// 최대 인원 — 2~8명, -/+ 스테퍼. 범위를 벗어나면 흔들림 효과로 알려준다.
const MIN_MAX = 2
const MAX_MAX = 8
const max = ref(8)
const maxShake = ref(false)
let maxShakeTimer: ReturnType<typeof setTimeout> | undefined

function shakeMax() {
  maxShake.value = false
  nextTick(() => {
    maxShake.value = true
  })
  clearTimeout(maxShakeTimer)
  maxShakeTimer = setTimeout(() => {
    maxShake.value = false
  }, 400)
}

function decMax() {
  if (max.value <= MIN_MAX) return shakeMax()
  max.value -= 1
}
function incMax() {
  if (max.value >= MAX_MAX) return shakeMax()
  max.value += 1
}
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
        <div class="visibility-toggle">
          <button type="button" :class="{ on: visibility === '공개' }" @click="visibility = '공개'">
            공개방
          </button>
          <button type="button" :class="{ on: visibility === '비밀' }" @click="visibility = '비밀'">
            비밀방
          </button>
        </div>
      </label>
      <label>
        최대 인원 <span class="hint">(2~8명)</span>
        <div class="stepper" :class="{ shake: maxShake }">
          <button type="button" @click="decMax">−</button>
          <span>{{ max }}명</span>
          <button type="button" @click="incMax">＋</button>
        </div>
      </label>
      <label v-if="visibility === '비밀'" class="password-field">
        비밀번호
        <input
          :value="password"
          type="text"
          inputmode="numeric"
          maxlength="6"
          placeholder="숫자 6자리"
          @input="onPasswordInput"
        />
      </label>
    </div>
    <div class="modal-actions">
      <PixelButton block @click="emit('close')">취소</PixelButton>
      <PixelButton
        variant="primary"
        block
        @click="emit('create', { title, visibility, max: String(max), password: visibility === '비밀' ? password : undefined })"
      >
        방 만들기
      </PixelButton>
    </div>
  </PixelModal>
</template>

<style scoped>
:deep(.modal) { width: 520px; padding: 30px; }
h3 { margin: 0 0 9px; font-size: 18px; }
p { margin: 0 0 20px; color: var(--c-muted); font-size: 12px; }
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.form-grid label {
  font-size: 11px;
  font-weight: 700;
}
.hint { font-weight: 400; color: var(--c-muted); }
.form-grid label:first-child { grid-column: 1 / -1; }
.password-field { grid-column: 1 / -1; }
.form-grid input {
  width: 100%;
  height: 48px;
  margin-top: 7px;
  padding: 0 13px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: #fff;
  font-size: 13px;
}
.visibility-toggle {
  display: flex;
  height: 48px;
  margin-top: 7px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: #fff;
  overflow: hidden;
}
.visibility-toggle button {
  flex: 1;
  height: 100%;
  border: 0;
  border-left: 2px solid var(--c-ink);
  background: #fff;
  font-size: 13px;
  font-weight: 700;
  color: var(--c-muted);
}
.visibility-toggle button:first-child { border-left: 0; }
.visibility-toggle button.on {
  background: var(--c-yellow);
  color: var(--c-ink);
}
.stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 7px;
  height: 48px;
  padding: 0 6px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: #fff;
}
.stepper button {
  width: 34px;
  height: 34px;
  border: 2px solid var(--c-ink);
  border-radius: 8px;
  background: var(--c-mint-soft);
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
}
.stepper button:active { transform: translate(1px, 1px); }
.stepper span { font-size: 14px; font-weight: 700; }
.stepper.shake { animation: stepper-shake 0.4s ease; }
@keyframes stepper-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-5px); }
  40% { transform: translateX(5px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
.modal-actions {
  display: flex;
  gap: 9px;
  margin-top: 16px;
}
.modal-actions > * { flex: 1; }
</style>
