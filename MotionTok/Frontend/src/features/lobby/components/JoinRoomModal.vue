<script setup lang="ts">
/**
 * 6자리 값을 입력받는 모달. 기본은 방 코드 참가(-25)이고, props로 문구·입력 규칙만 바꾸면
 * 비밀방 입장 비밀번호 입력(-68)에도 그대로 쓴다 — 둘 다 "6자리 입력 후 join"으로 폼이 같다.
 */
import { ref } from 'vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const props = withDefaults(
  defineProps<{
    heading?: string
    desc?: string
    placeholder?: string
    submitLabel?: string
    /** true면 숫자만 받는다(비밀번호). 기본은 방 코드라 영숫자 대문자. */
    numeric?: boolean
    /** 입장 실패 문구 — 채워지면 모달을 닫지 않고 여기에 표시해 재입력을 받는다. */
    errorText?: string
    busy?: boolean
  }>(),
  {
    heading: '방 코드로 참가',
    desc: '친구에게 받은 6자리 코드를 입력해 주세요.',
    placeholder: '예: MP4X9K',
    submitLabel: '참가하기',
    numeric: false,
    errorText: '',
    busy: false,
  },
)

const emit = defineEmits<{ close: []; join: [code: string] }>()

const code = ref('')
const onInput = (e: Event) => {
  const input = e.target as HTMLInputElement
  code.value = props.numeric
    ? input.value.replace(/[^0-9]/g, '').slice(0, 6)
    : input.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  input.value = code.value
  }
</script>

<template>
  <PixelModal @close="emit('close')">
    <h3>{{ heading }}</h3>
    <p>{{ desc }}</p>
    <input
      :value="code"
      :placeholder="placeholder"
      :inputmode="numeric ? 'numeric' : undefined"
      :class="{ numeric }"
      maxlength="6"
      @input="onInput"
    />
    <p v-if="errorText" class="error">{{ errorText }}</p>
    <div class="modal-actions">
      <PixelButton block @click="emit('close')">취소</PixelButton>
      <PixelButton variant="primary" block :disabled="busy" @click="emit('join', code)">
        {{ submitLabel }}
      </PixelButton>
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
/* 비밀번호는 숫자라 대문자 변환이 무의미하고, 자간을 벌려 6자리를 세기 쉽게 한다 */
input.numeric {
  text-transform: none;
  letter-spacing: 4px;
}
.error {
  margin: 9px 0 0;
  color: #e85d6e;
  font-size: 11px;
}
.modal-actions {
  display: flex;
  gap: 9px;
  margin-top: 16px;
}
.modal-actions > * { flex: 1; }
</style>
