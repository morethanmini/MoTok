<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const props = withDefaults(
  defineProps<{
    heading?: string
    desc?: string
    placeholder?: string
    submitLabel?: string
    numeric?: boolean
    errorText?: string
    busy?: boolean
  }>(),
  {
    heading: '방 코드로 참가',
    desc: '친구에게 받은 6자리 코드를 입력해주세요.',
    placeholder: '예: MP4X9K',
    submitLabel: '참가',
    numeric: false,
    errorText: '',
    busy: false,
  },
)

const emit = defineEmits<{ close: []; join: [code: string] }>()

const code = ref('')
const codeInput = ref<HTMLInputElement>()
const codeLength = computed(() => code.value.length)
const codeReady = computed(() => codeLength.value === 6)
const codeSlots = computed(() => Array.from({ length: 6 }, (_, index) => code.value[index] ?? ''))

onMounted(() => nextTick(() => codeInput.value?.focus()))

function onInput(e: Event) {
  const input = e.target as HTMLInputElement
  code.value = props.numeric
    ? input.value.replace(/[^0-9]/g, '').slice(0, 6)
    : input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  input.value = code.value
}

function submit() {
  if (!props.busy && codeReady.value) emit('join', code.value)
}
</script>

<template>
  <PixelModal variant="lobby" @close="emit('close')">
    <form class="code-door" @submit.prevent="submit">
      <button class="close-button" type="button" aria-label="코드 입장 닫기" @click="emit('close')">×</button>

      <header class="code-door-head">
        <h3>{{ heading }}</h3>
        <p>{{ desc }}</p>
      </header>

      <div class="entry-panel" :class="{ ready: codeReady, invalid: errorText }" @click="codeInput?.focus()">
        <div class="entry-label">
          <label for="room-code">INVITE CODE</label>
          <span>{{ codeLength }} / 6</span>
        </div>
        <div class="code-slots" aria-hidden="true">
          <span v-for="(slot, index) in codeSlots" :key="index" :class="{ filled: slot }">{{ slot || '·' }}</span>
        </div>
        <input
          id="room-code"
          ref="codeInput"
          :value="code"
          :placeholder="placeholder"
          :inputmode="numeric ? 'numeric' : 'text'"
          :class="{ numeric }"
          maxlength="6"
          autocomplete="off"
          aria-describedby="code-help"
          @input="onInput"
        />
      </div>

      <p id="code-help" class="help-text">
        <span aria-hidden="true">✦</span>
        {{ numeric ? '숫자 6자리를 입력해 주세요.' : '영문과 숫자 6자리를 입력해 주세요.' }}
      </p>
      <p v-if="errorText" class="error" role="alert">{{ errorText }}</p>

      <footer class="modal-actions">
        <PixelButton block type="button" @click="emit('close')">다음에 할게요</PixelButton>
        <PixelButton variant="primary" block type="submit" :disabled="busy || !codeReady">
          {{ busy ? '문 여는 중…' : submitLabel }} <span aria-hidden="true">↗</span>
        </PixelButton>
      </footer>
    </form>
  </PixelModal>
</template>

<style scoped>
:deep(.modal.lobby) { width: 440px; padding: 0; overflow: hidden; }
.code-door { position: relative; padding: 0 28px 27px; color: #4d3729; }
.close-button { position: absolute; z-index: 2; top: 13px; right: 14px; width: 29px; height: 29px; border: 2px solid #d8bd95; border-radius: 50%; background: #fffaf0; color: #9b765d; font-size: 21px; line-height: 21px; cursor: pointer; }.close-button:hover { background: #fde8d7; color: #bb6256; }
.code-door-head { position: relative; margin: 0 -28px 21px; padding: 24px 54px 18px; overflow: hidden; border-bottom: 2px solid #dec59e; background: linear-gradient(135deg, #fff7e7 0%, #ffefd2 100%); text-align: center; }.code-door-head::after { position: absolute; right: -30px; bottom: -55px; width: 150px; height: 150px; border: 2px solid rgba(207,145,101,.2); border-radius: 50%; content: ''; }
.code-door h3 { position: relative; z-index: 1; margin: 0 0 5px; color: #392b22; font-family: var(--font-pixel); font-size: 24px; font-weight: 400; }.code-door-head p { position: relative; z-index: 1; margin: 0; color: #87715e; font-size: 12px; line-height: 1.55; }
.entry-panel { position: relative; padding: 13px; border: 2px solid #d8bd95; border-radius: 10px; background: #fffdf8; box-shadow: inset 0 1px 2px rgba(116,78,48,.07); cursor: text; transition: border-color .16s ease, box-shadow .16s ease; }.entry-panel:focus-within { border-color: #cd8065; box-shadow: 0 0 0 3px rgba(205,128,101,.14); }.entry-panel.ready { border-color: #7ca565; box-shadow: 0 0 0 3px rgba(124,165,101,.14); }.entry-panel.invalid { border-color: #d66a67; }
.entry-label { display: flex; justify-content: space-between; margin-bottom: 9px; color: #98745c; font-size: 9px; font-weight: 800; letter-spacing: .9px; }.entry-label span { color: #b39987; letter-spacing: 0; }
.code-slots { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; pointer-events: none; }.code-slots span { display: grid; height: 37px; place-items: center; border-bottom: 2px solid #dcc8a8; color: #d7c3a2; font-family: var(--font-pixel); font-size: 19px; transition: color .12s ease, border-color .12s ease; }.code-slots span.filled { border-color: #bd795e; color: #674333; }
.entry-panel input { position: absolute; right: 13px; bottom: 13px; left: 13px; width: calc(100% - 26px); height: 37px; margin: 0; padding: 0; border: 0; outline: 0; opacity: 0; cursor: text; }.entry-panel input.numeric { letter-spacing: 4px; }
.help-text { margin: 9px 2px 0; color: #9b8572; font-size: 10px; }.help-text span { margin-right: 4px; color: #dc8d70; }.error { margin: 9px 2px 0; color: #ce5a61; font-size: 11px; font-weight: 700; }
.modal-actions { display: flex; gap: 9px; margin-top: 20px; }.modal-actions > * { flex: 1; }.modal-actions :deep(.px-btn) { border: 2px solid #9a674b; border-radius: 7px; box-shadow: 3px 3px 0 #c6a47d; font-size: 14px; }.modal-actions :deep(.v-secondary) { background: #fffaf0; color: #6e5646; }.modal-actions :deep(.v-primary) { background: #e97872; }.modal-actions :deep(.v-primary:disabled) { background: #d9ccc4; color: #947f75; }
@media (max-width: 480px) { .code-door { padding-right: 18px; padding-left: 18px; }.code-door-head { margin-right: -18px; margin-left: -18px; }.code-slots { gap: 4px; }.code-slots span { font-size: 16px; }.modal-actions { flex-direction: column-reverse; } }
</style>
