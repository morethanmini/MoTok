<script setup lang="ts">
/**
 * 방 정보 입력 모달. 제목/공개설정/최대인원(+비밀방 비번)을 받아 create로 emit한다.
 * 방 생성(-24)이 기본 모드이고, props로 현재값·문구·정원 하한을 주면 방 정보 수정(-130)
 * 모달로도 그대로 쓴다 — 입력 필드가 생성과 완전히 동일해서(명세 §4 "생성과 동일 규격")
 * 별도 컴포넌트를 만들지 않았다.
 */
import { nextTick, ref } from 'vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

export interface NewRoom {
  title: string
  visibility: string
  max: string
  password?: string
}

const props = withDefaults(
  defineProps<{
    /** 현재값 프리필 — 수정 모드에서만 넘긴다. 생성 모드는 생략(빈 폼). */
    initial?: NewRoom
    heading?: string
    desc?: string
    submitLabel?: string
    /** 최대 인원 하한. 수정 모드에선 현재 참가자 수 — 그 아래로는 못 줄인다(서버도 409로 거부). */
    minPlayers?: number
  }>(),
  {
    initial: undefined,
    heading: '새 게임방 만들기',
    desc: '친구들과 사용할 방 정보를 설정해 주세요.',
    submitLabel: '방 만들기',
    minPlayers: 2,
  },
)

const emit = defineEmits<{ close: []; create: [payload: NewRoom] }>()

const title = ref(props.initial?.title ?? '')
const visibility = ref(props.initial?.visibility ?? '공개')
// 수정 모드에선 방장 전용 조회(GET /{roomId}/password)로 받은 기존 비번을 되채운다.
// 생성 모드는 initial이 없어 빈 값으로 시작한다.
const password = ref(props.initial?.password ?? '')
function onPasswordInput(e: Event) {
  const input = e.target as HTMLInputElement
  password.value = input.value.replace(/[^0-9]/g, '').slice(0, 6)
  input.value = password.value
}

// 최대 인원 — minPlayers~8명, -/+ 스테퍼. 범위를 벗어나면 흔들림 효과로 알려준다.
const MAX_MAX = 8
const max = ref(Number(props.initial?.max ?? MAX_MAX))
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
  if (max.value <= props.minPlayers) return shakeMax()
  max.value -= 1
}
function incMax() {
  if (max.value >= MAX_MAX) return shakeMax()
  max.value += 1
}
</script>

<template>
  <PixelModal @close="emit('close')">
    <h3>{{ heading }}</h3>
    <p>{{ desc }}</p>
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
        최대 인원 <span class="hint">({{ minPlayers }}~8명)</span>
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
        {{ submitLabel }}
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
