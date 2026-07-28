<script setup lang="ts">
/**
 * 친구 1:1 귓속말 대화창(-150).
 *
 * 보낸 말을 로컬에 미리 그리지 않는다 — 서버가 거절하면(친구가 아니거나 상대가 오프라인)
 * 유령 말풍선이 남는다. 성공한 말은 에코로 돌아와 그때 그려진다(대기실 채팅과 같은 규약).
 */
import { computed, nextTick, ref, watch } from 'vue'
import PixelModal from '@/components/common/PixelModal.vue'
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
  <PixelModal @close="emit('close')">
    <h3>{{ nickname }}님과의 귓속말</h3>

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
  </PixelModal>
</template>

<style scoped>
h3 { margin: 0 0 12px; }
.thread {
  height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--c-surface-sunken, #f6f7f9);
  border: 2px solid var(--c-line, #d7dbe3);
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
  background: #fff;
  border: 2px solid var(--c-line, #d7dbe3);
}
.line.mine .bubble { background: var(--c-primary-soft, #dce7ff); }
.time { font-size: 10px; color: var(--c-muted); }
.notice { margin: 8px 0 0; font-size: 11px; color: var(--c-danger, #dc2626); }
.composer { display: flex; gap: 8px; margin-top: 12px; }
.composer input {
  flex: 1;
  padding: 9px 10px;
  font-family: inherit;
  font-size: 12px;
  border: 2px solid var(--c-line, #d7dbe3);
}
</style>
