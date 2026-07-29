/**
 * 친구 귓속말(-150) — 전역 STOMP 연결 위의 1:1 대화.
 *
 * ## 왜 모듈 레벨 수신함인가
 * 귓속말은 대화창을 열어 두지 않아도 도착한다. 창을 여는 컴포넌트가 구독을 소유하면
 * 창이 닫힌 사이에 온 말이 사라지므로, 수신함은 앱 수명에 두고 창은 그걸 들여다보기만 한다.
 * 안 읽음 배지도 같은 이유로 여기 있다.
 *
 * ## 유실을 전제로 만든다
 * 개인 큐 메시지는 받을 사람이 접속 중이 아니면 서버가 조용히 버린다. 그래서
 * ① 서버가 보내기 전에 상대의 접속을 확인하고(오프라인이면 발신자에게 에러),
 * ② 대화를 Redis Stream에 남겨 두고, ③ 대화창을 열 때 REST로 이력을 받는다.
 * 실시간 프레임은 "이미 열려 있는 창에 한 줄 더"의 역할만 한다.
 */
import { computed, reactive, readonly, ref } from 'vue'
import { whispersApi } from '@/api/modules/whispers'
import type { WhisperMessage } from '@/api/types'
import { isMemberSession, publishGlobal, subscribeGlobal } from './useGlobalStomp'

const WHISPER_QUEUE = '/user/queue/whisper'

/** 상대 userId → 대화 내용(시간순). */
const conversations = reactive(new Map<number, WhisperMessage[]>())
/** 상대 userId → 아직 안 읽은 수. */
const unread = reactive(new Map<number, number>())
/** 지금 열려 있는 대화창의 상대. 열려 있는 대화는 도착 즉시 읽음 처리한다. */
const openWith = ref<number | null>(null)
const openNickname = ref('')
/**
 * 방금 도착한 <b>안 읽은</b> 귓속말 — 앱 전역 알림(토스트)이 이걸 지켜본다.
 *
 * 화면에 이미 떠 있는 대화는 알릴 이유가 없으므로 열려 있는 상대의 말과 내 에코는 담지 않는다.
 * 수신함과 마찬가지로 모듈 수명에 둔다 — 어느 화면에 있든 알림은 떠야 한다.
 */
const incoming = ref<WhisperMessage | null>(null)
const loadedHistory = new Set<number>()
let started = false

function append(message: WhisperMessage) {
  const peer = message.conversationWith
  const thread = conversations.get(peer) ?? []
  // 같은 메시지가 두 번 들어오는 일(재연결 직후 이력 재조회)을 ID로 막는다.
  if (thread.some((m) => m.whisperId === message.whisperId)) return
  conversations.set(peer, [...thread, message])
  if (message.mine || openWith.value === peer) return
  unread.set(peer, (unread.get(peer) ?? 0) + 1)
  incoming.value = message
}

/** App 수명 동안 한 번만 구독한다. */
function ensureStarted() {
  if (started || !isMemberSession()) return
  started = true
  subscribeGlobal(WHISPER_QUEUE, (body) => {
    try {
      append(JSON.parse(body) as WhisperMessage)
    } catch {
      // 형식 오류 프레임은 무시
    }
  })
}

export function useWhisper() {
  ensureStarted()

  const totalUnread = computed(() =>
    Array.from(unread.values()).reduce((sum, count) => sum + count, 0),
  )

  function messagesWith(userId: number) {
    return conversations.get(userId) ?? []
  }

  function unreadWith(userId: number) {
    return unread.get(userId) ?? 0
  }

  /** 대화창을 연다 — 처음 여는 상대면 이력을 한 번 받아 온다. */
  async function open(userId: number, nickname = '친구') {
    openWith.value = userId
    openNickname.value = nickname
    unread.set(userId, 0)
    if (incoming.value?.conversationWith === userId) incoming.value = null
    if (loadedHistory.has(userId)) return
    loadedHistory.add(userId)
    try {
      const history = await whispersApi.history(userId)
      const known = new Set((conversations.get(userId) ?? []).map((m) => m.whisperId))
      // 이력과 그 사이 실시간으로 받은 말이 섞이지 않게 ID로 합친다.
      conversations.set(userId, [
        ...history.filter((m) => !known.has(m.whisperId)),
        ...(conversations.get(userId) ?? []),
      ])
    } catch {
      loadedHistory.delete(userId) // 다음에 다시 시도할 수 있게
    }
  }

  function close() {
    openWith.value = null
    openNickname.value = ''
  }

  /** @returns 발행 성공 여부. 실패(미연결)면 호출부가 안내한다. */
  function send(userId: number, text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return false
    // 로컬에 미리 그리지 않는다 — 서버가 거절하면(친구 아님·오프라인) 유령 말풍선이 남는다.
    // 성공하면 같은 메시지가 에코로 돌아와 그때 그려진다.
    return publishGlobal(`/app/friends/${userId}/whisper`, { text: trimmed })
  }

  return {
    openWith: readonly(openWith),
    openNickname: readonly(openNickname),
    /** 전역 알림용 — App.vue가 지켜보고 토스트를 띄운다. 소비 후 clearIncoming()으로 비운다. */
    incoming: readonly(incoming),
    clearIncoming: () => (incoming.value = null),
    totalUnread,
    messagesWith,
    unreadWith,
    open,
    close,
    send,
  }
}
