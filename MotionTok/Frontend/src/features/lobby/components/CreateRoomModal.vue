<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

export interface NewRoom {
  title: string
  visibility: string
  max: string
  password?: string
}

const props = withDefaults(
  defineProps<{ initial?: NewRoom; heading?: string; desc?: string; submitLabel?: string; minPlayers?: number; busy?: boolean }>(),
  { initial: undefined, heading: '새 게임방 만들기', desc: '친구들과 즐길 모션 파티를 준비해 보세요.', submitLabel: '방 만들기', minPlayers: 2, busy: false },
)
const emit = defineEmits<{ close: []; create: [payload: NewRoom] }>()
const title = ref(props.initial?.title ?? '')
const visibility = ref(props.initial?.visibility ?? '공개')
const password = ref(props.initial?.password ?? '')
function onPasswordInput(e: Event) {
  const input = e.target as HTMLInputElement
  password.value = input.value.replace(/[^0-9]/g, '').slice(0, 6)
  input.value = password.value
}
const MAX_MAX = 8
/** 새 방 기본 정원 — 정원까지 채우는 방이 드물어 꽉 찬 8보다 낮게 잡는다(수정 시엔 기존 값이 온다). */
const DEFAULT_MAX = 6
const max = ref(Number(props.initial?.max ?? DEFAULT_MAX))
const maxShake = ref(false)
let maxShakeTimer: ReturnType<typeof setTimeout> | undefined
function shakeMax() {
  maxShake.value = false
  nextTick(() => { maxShake.value = true })
  clearTimeout(maxShakeTimer)
  maxShakeTimer = setTimeout(() => { maxShake.value = false }, 400)
}
function decMax() { if (max.value <= props.minPlayers) return shakeMax(); max.value -= 1 }
function incMax() { if (max.value >= MAX_MAX) return shakeMax(); max.value += 1 }

/**
 * 가운데 숫자를 누르면 고를 수 있는 목록이 뜬다 — 2에서 8까지 여섯 번 누르지 않아도 되게.
 *
 * 아래가 아니라 위로 펼친다. 이 칸 밑으로는 비밀방일 때 비밀번호 칸과 만들기 버튼이 있어서
 * 아래로 열면 그 위를 덮는다. 모달이 overflow:hidden이라 위쪽은 헤더까지 여유가 넉넉하다.
 */
const stepperEl = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const maxOptions = computed(() =>
  Array.from({ length: MAX_MAX - props.minPlayers + 1 }, (_, i) => props.minPlayers + i),
)
function pickMax(n: number) { max.value = n; menuOpen.value = false }
function onDocPointerDown(e: PointerEvent) {
  if (menuOpen.value && !stepperEl.value?.contains(e.target as Node)) menuOpen.value = false
}
function onDocKeydown(e: KeyboardEvent) {
  if (menuOpen.value && e.key === 'Escape') menuOpen.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onDocKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onDocKeydown)
})
</script>

<template>
  <PixelModal variant="lobby" @close="emit('close')">
    <section class="room-form" aria-labelledby="create-room-title">
      <header class="room-form-head">
        <span>GAME ROOM</span>
        <h3 id="create-room-title">{{ heading }}</h3>
        <p>{{ desc }}</p>
      </header>

      <div class="form-grid">
        <label class="title-field">
          <span>방 제목</span>
          <input v-model="title" placeholder="신나는 모션 파티" />
        </label>
        <label>
          <span>공개 설정</span>
          <div class="visibility-toggle">
            <button type="button" :class="{ on: visibility === '공개' }" @click="visibility = '공개'">공개방</button>
            <button type="button" :class="{ on: visibility === '비밀' }" @click="visibility = '비밀'">비밀방</button>
          </div>
        </label>
        <label>
          <span>최대 인원 <small>{{ minPlayers }}~8명</small></span>
          <div ref="stepperEl" class="stepper" :class="{ shake: maxShake }">
            <button class="minus-button" type="button" aria-label="인원 줄이기" @click="decMax">−</button>
            <button class="max-value" type="button" aria-haspopup="listbox" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">{{ max }}명</button>
            <button type="button" aria-label="인원 늘리기" @click="incMax">+</button>
            <div v-if="menuOpen" class="max-menu" role="listbox" aria-label="최대 인원 선택">
              <button v-for="n in maxOptions" :key="n" type="button" role="option" :class="{ on: n === max }" :aria-selected="n === max" @click="pickMax(n)">{{ n }}명</button>
            </div>
          </div>
        </label>
        <label v-if="visibility === '비밀'" class="password-field">
          <span>비밀번호</span>
          <input :value="password" type="text" inputmode="numeric" maxlength="6" placeholder="숫자 6자리" @input="onPasswordInput" />
        </label>
      </div>

      <footer class="modal-actions">
        <PixelButton block @click="emit('close')">취소</PixelButton>
        <PixelButton variant="primary" block :disabled="busy" @click="emit('create', { title, visibility, max: String(max), password: visibility === '비밀' ? password : undefined })">
          {{ submitLabel }}
        </PixelButton>
      </footer>
    </section>
  </PixelModal>
</template>

<style scoped>
:deep(.modal.lobby) { width: 520px; padding: 0; overflow: hidden; }
.room-form { padding: 0 28px 28px; }
.room-form-head { margin: 0 -28px 24px; padding: 22px 28px 19px; border-bottom: 2px solid #dec59e; background: #fff7e7; text-align: center; }
.room-form-head > span { color: #b17b51; font-size: 9px; font-weight: 700; letter-spacing: 1.1px; }
h3 { margin: 6px 0 5px; color: #392b22; font-family: var(--font-pixel); font-size: 24px; font-weight: 400; letter-spacing: -.3px; }
p { margin: 0; color: #87715e; font-size: 12px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 17px 14px; }
.form-grid label { display: grid; gap: 7px; color: #574233; font-size: 15px; font-weight: 700; }
.title-field, .password-field { grid-column: 1 / -1; }
small { margin-left: 4px; color: #9d8978; font-size: 10px; font-weight: 400; }
.form-grid input { width: 100%; height: 46px; box-sizing: border-box; padding: 0 12px; border: 2px solid #d8bd95; border-radius: 7px; background: #fffdf8; box-shadow: inset 0 1px 2px rgba(116,78,48,.07); color: #453326; font-size: 13px; }
.form-grid input::placeholder { color: #b3a294; }.form-grid input:focus { outline: 0; border-color: #cd8065; box-shadow: 0 0 0 3px rgba(205,128,101,.14); }
.visibility-toggle, .stepper { display: flex; height: 46px; border: 2px solid #d8bd95; border-radius: 7px; background: #fffdf8; overflow: hidden; }
/* 드롭 목록이 칸 밖으로 나가야 해서 여기만 잘라내지 않는다 */
.stepper { position: relative; overflow: visible; }
.visibility-toggle button { flex: 1; border: 0; border-left: 1px solid #e2ccb0; background: transparent; color: #947f6d; font-size: 15px; font-weight: 700; }.visibility-toggle button:first-child { border-left: 0; }.visibility-toggle button.on { background: #f4dfae; color: #59412f; }
.stepper { align-items: center; justify-content: space-between; padding: 0 5px; }.stepper button { width: 32px; height: 32px; border: 1px solid #bd8d63; border-radius: 5px; background: #f7ead0; color: #714c35; font-size: 18px; font-weight: 800; line-height: 1; }.stepper .minus-button { position: relative; font-size: 0; }.stepper .minus-button::after { content: ''; position: absolute; top: 50%; left: 8px; width: 14px; height: 3px; border-radius: 2px; background: #714c35; transform: translateY(-50%); }.stepper button:active { transform: translateY(1px); }.stepper.shake { animation: stepper-shake .4s ease; }
.stepper .max-value { width: auto; min-width: 66px; height: 34px; padding: 0 7px; border: 0; background: transparent; color: #59412f; font-size: 13px; font-weight: 700; cursor: pointer; }
.stepper .max-value:hover { background: #f7ead0; }
.stepper .max-value[aria-expanded='true'] { background: #f4dfae; }
.max-menu { position: absolute; bottom: calc(100% + 6px); left: 50%; z-index: 5; display: grid; gap: 2px; padding: 5px; border: 2px solid #d8bd95; border-radius: 8px; background: #fffdf8; box-shadow: 0 6px 16px rgba(116, 78, 48, .18); transform: translateX(-50%); animation: max-menu-in .12s ease; }
.max-menu button { width: 78px; height: 30px; border: 0; border-radius: 5px; background: transparent; color: #6b5443; font-size: 13px; font-weight: 700; }
.max-menu button:hover { background: #f7ead0; }
.max-menu button.on { background: #f4dfae; color: #59412f; }
@keyframes max-menu-in { from { opacity: 0; transform: translate(-50%, 4px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes stepper-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.modal-actions { display: flex; gap: 9px; margin-top: 25px; }.modal-actions > * { flex: 1; }.modal-actions :deep(.px-btn) { border: 2px solid #9a674b; border-radius: 7px; box-shadow: 3px 3px 0 #c6a47d; font-size: 16px; }.modal-actions :deep(.v-secondary) { background: #fffaf0; color: #6e5646; }.modal-actions :deep(.v-primary) { background: #e97872; }
@media (max-width: 520px) { .room-form { padding: 0 18px 20px; }.room-form-head { margin-right: -18px; margin-left: -18px; padding-right: 18px; padding-left: 18px; }.form-grid { grid-template-columns: 1fr; }.title-field, .password-field { grid-column: auto; } }
</style>
