<script setup lang="ts">
/**
 * 친구 1:1 귓속말 대화창(-150).
 *
 * 보낸 말을 로컬에 미리 그리지 않는다 — 서버가 거절하면(친구가 아니거나 상대가 오프라인)
 * 유령 말풍선이 남는다. 성공한 말은 에코로 돌아와 그때 그려진다(대기실 채팅과 같은 규약).
 */
import { computed, nextTick, ref, watch } from 'vue'
import PixelButton from '@/components/common/PixelButton.vue'
import type { WhisperMessage } from '@/api/types'

const props = defineProps<{
  nickname: string
  messages: WhisperMessage[]
  connected: boolean
}>()
const emit = defineEmits<{ close: []; send: [text: string] }>()

const MAX_LENGTH = 500

const draft = ref('')
const scroller = ref<HTMLElement | null>(null)
const tooLong = computed(() => draft.value.length > MAX_LENGTH)

function submit() {
  const text = draft.value.trim()
  if (!text || tooLong.value || !props.connected) return
  emit('send', text)
  draft.value = ''
}

function timeOf(sentAt: string) {
  return new Date(sentAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

// 새 말이 오면 아래로 붙인다 — 대화창은 최신이 보여야 한다.
watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  },
  { immediate: true },
)
</script>

<template>
  <section class="whisper-dock" aria-label="귓속말 채팅창">
    <header class="whisper-head">
      <b>{{ nickname }}</b><span>님과의 채팅</span>
      <button type="button" aria-label="채팅창 닫기" @click="emit('close')">×</button>
    </header>

    <div ref="scroller" class="thread">
      <p v-if="messages.length === 0" class="empty">
        아직 나눈 이야기가 없어요. 먼저 말을 걸어 보세요.
      </p>
      <div v-for="m in messages" :key="m.whisperId" class="line" :class="{ mine: m.mine }">
        <span class="bubble">{{ m.text }}</span>
        <span class="time">{{ timeOf(m.sentAt) }}</span>
      </div>
    </div>

    <p v-if="!connected" class="notice">실시간 연결이 끊겨 있어요. 잠시 후 다시 시도해 주세요.</p>
    <p v-else-if="tooLong" class="notice">{{ MAX_LENGTH }}자까지 보낼 수 있어요.</p>

    <div class="composer">
      <input
        v-model="draft"
        :disabled="!connected"
        placeholder="귓속말 보내기"
        @keydown.enter="submit"
      />
      <PixelButton variant="primary" :disabled="!connected || tooLong" @click="submit">보내기</PixelButton>
    </div>
  </section>
</template>

<style scoped>
.whisper-dock { position: fixed; z-index: 40; right: 24px; bottom: 20px; width: min(360px, calc(100vw - 32px)); padding: 0; border: 3px solid #8e6049; border-radius: 12px 12px 5px 5px; background: #fffaf0; box-shadow: 5px 5px 0 #b88965; overflow: hidden; }.whisper-head { display: flex; align-items: center; gap: 4px; padding: 11px 13px; border-bottom: 2px solid #e5c99f; background: #f7df9e; color: #52372a; font-size: 11px; }.whisper-head b { font-size: 12px; }.whisper-head button { width: 24px; height: 24px; margin-left: auto; border: 0; border-radius: 4px; background: #fff5db; color: #6e4937; font-size: 18px; line-height: 1; }
.thread {
  height: 230px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: #fffdf7;
  border: 0;
}
.empty { margin: auto; color: var(--c-muted); font-size: 11px; text-align: center; }
.line { display: flex; align-items: flex-end; gap: 6px; }
.line.mine { flex-direction: row-reverse; }
.bubble {
  max-width: 74%;
  padding: 7px 10px;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
  background: #fff2c7;
  border: 2px solid #d4ad84;
}
.line.mine .bubble { background: #dcecbf; border-color: #9db783; }.time { font-size: 10px; color: #9b806c; }.notice { margin: 8px 12px 0; font-size: 10px; color: #c66557; }.composer { display: flex; gap: 7px; margin: 10px 12px 12px; }
.composer input {
  flex: 1;
  padding: 9px 10px;
  font-family: inherit;
  font-size: 12px;
  border: 2px solid #c99c76;
  border-radius: 6px;
  background: #fffef8;
}
.composer :deep(.px-btn) { min-width: 64px; border: 2px solid #9a6b4f; border-radius: 6px; box-shadow: 2px 2px 0 #bd916e; font-size: 9px; }
@media (max-width: 600px) { .whisper-dock { right: 16px; bottom: 16px; } }
</style>
