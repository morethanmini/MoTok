/**
 * 대기실 채팅 + 게임 제안 컴포저블 (STOMP over WebSocket, 명세 §7 대기실 채팅).
 *
 * 흐름: connect(roomId) → /topic/rooms/{roomId}/chat 구독(수신) + /user/queue/errors 구독(내 에러만).
 * 발신은 REST가 아니라 client.publish — 자기 메시지도 topic으로 에코되어 돌아오므로,
 * sendChat/suggestGame은 로컬에 미리 추가하지 않고 수신 시에만 messages에 append한다.
 *
 * 뷰에서의 사용 (예):
 *   const chat = useRoomChat()
 *   await chat.connect(roomId)
 *   chat.sendChat('안녕하세요')
 *   chat.suggestGame(7, '몸으로 말해요')
 */
import { onScopeDispose, readonly, ref, shallowRef } from 'vue'
import { Client, type StompSubscription } from '@stomp/stompjs'
import { API_BASE } from '@/api/http'
import { getAccessToken } from '@/api/token'
import type { ChatMessage, StompErrorPayload } from '@/api/types'

/** API_BASE('http(s)://host/api')에서 STOMP 브로커 URL('ws(s)://host/ws')을 유도한다. */
function resolveBrokerUrl(): string {
  const httpBase = API_BASE.replace(/\/api\/?$/, '')
  return httpBase.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws'
}

const CHAT_MAX_LEN = 500

export function useRoomChat() {
  let client: Client | null = null
  let chatSub: StompSubscription | null = null
  let errorSub: StompSubscription | null = null
  let currentRoomId: string | null = null

  const connected = ref(false)
  const messages = shallowRef<ChatMessage[]>([])
  const lastError = ref<StompErrorPayload | null>(null)

  function handleChatFrame(body: string) {
    try {
      const msg = JSON.parse(body) as ChatMessage
      messages.value = [...messages.value, msg]
    } catch {
      // 파싱 실패한 프레임은 무시(형식 오류 방어)
    }
  }

  function handleErrorFrame(body: string) {
    try {
      const err = JSON.parse(body) as StompErrorPayload
      // /user/queue/errors는 시그널과 공용 — 채팅/게임 제안 발신 경로만 걸러낸다.
      if (err.path?.endsWith('/chat') || err.path?.endsWith('/game-suggest')) {
        lastError.value = err
      }
    } catch {
      // 무시
    }
  }

  function connect(roomId: string): Promise<void> {
    disconnect()
    currentRoomId = roomId
    messages.value = []
    lastError.value = null

    return new Promise((resolve) => {
      const c = new Client({
        brokerURL: resolveBrokerUrl(),
        reconnectDelay: 3000,
        debug: import.meta.env.DEV ? (msg) => console.debug('[STOMP]', msg) : undefined,
        beforeConnect: () => {
          // 재연결마다 최신 accessToken으로 갱신 — 만료 토큰으로 재연결하면 CONNECT가 거부된다.
          c.connectHeaders = { Authorization: `Bearer ${getAccessToken() ?? ''}` }
        },
        onConnect: () => {
          connected.value = true
          chatSub = c.subscribe(`/topic/rooms/${roomId}/chat`, (frame) => handleChatFrame(frame.body))
          errorSub = c.subscribe('/user/queue/errors', (frame) => handleErrorFrame(frame.body))
          resolve()
        },
        onStompError: () => {
          // CONNECT 거부(토큰 문제 등) — ERROR 프레임 + 연결 종료. 재연결은 라이브러리가 처리.
          connected.value = false
          resolve()
        },
        onWebSocketClose: () => {
          connected.value = false
        },
      })
      client = c
      c.activate()
    })
  }

  function disconnect() {
    chatSub?.unsubscribe()
    errorSub?.unsubscribe()
    chatSub = null
    errorSub = null
    currentRoomId = null
    connected.value = false
    void client?.deactivate()
    client = null
  }

  /** 채팅 발신. 로컬 append 없음 — 성공하면 같은 메시지가 구독 중인 topic으로 돌아온다. */
  function sendChat(text: string) {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length > CHAT_MAX_LEN || !client?.connected || !currentRoomId) return
    client.publish({ destination: `/app/rooms/${currentRoomId}/chat`, body: JSON.stringify({ text: trimmed }) })
  }

  /** 게임 제안 발신(비방장). gameId는 카탈로그 id, gameName은 카탈로그 name 그대로. */
  function suggestGame(gameId: number, gameName: string) {
    if (!client?.connected || !currentRoomId) return
    client.publish({
      destination: `/app/rooms/${currentRoomId}/game-suggest`,
      body: JSON.stringify({ gameId, gameName }),
    })
  }

  onScopeDispose(disconnect)

  return {
    connected: readonly(connected),
    messages,
    lastError,
    connect,
    disconnect,
    sendChat,
    suggestGame,
  }
}
