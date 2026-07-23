/**
 * 대기실 채팅 + 게임 제안 + 게임 세션 이벤트 컴포저블 (STOMP over WebSocket).
 * 방 하나에 대한 STOMP 연결을 공유한다 — 채팅(명세 §7)과 게임 이벤트(S15P11A706-115)가
 * 같은 소켓 위의 다른 토픽일 뿐이라 연결·재연결·인증을 한 곳에서 관리한다.
 *
 * 흐름: connect(roomId) → /topic/rooms/{roomId}/chat + /topic/rooms/{roomId}/game 구독
 *      + /user/queue/errors 구독(내 에러만).
 * 발신은 REST가 아니라 client.publish — 자기 메시지도 topic으로 에코되어 돌아오므로,
 * 발신 시 로컬에 미리 추가하지 않고 수신 시에만 append한다.
 *
 * 뷰에서의 사용 (예):
 *   const chat = useRoomChat()
 *   await chat.connect(roomId)
 *   chat.sendChat('안녕하세요')
 *   chat.startGame(1)               // 방장 — 서버가 GAME_START를 방 전체에 배포
 *   watch(chat.gameEvents, ...)     // GAME_START/PROGRESS/PLAYER_FINISHED/GAME_END 수신
 */
import { onScopeDispose, readonly, ref, shallowRef } from 'vue'
import { Client, type StompSubscription } from '@stomp/stompjs'
import { API_BASE } from '@/api/http'
import { getAccessToken } from '@/api/token'
import type { ChatMessage, GameEvent, StompErrorPayload } from '@/api/types'

/** API_BASE('http(s)://host/api')에서 STOMP 브로커 URL('ws(s)://host/ws')을 유도한다. */
function resolveBrokerUrl(): string {
  const httpBase = API_BASE.replace(/\/api\/?$/, '')
  return httpBase.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws'
}

const CHAT_MAX_LEN = 500

export function useRoomChat() {
  let client: Client | null = null
  let chatSub: StompSubscription | null = null
  let gameSub: StompSubscription | null = null
  let errorSub: StompSubscription | null = null
  let currentRoomId: string | null = null

  const connected = ref(false)
  const messages = shallowRef<ChatMessage[]>([])
  const gameEvents = shallowRef<GameEvent[]>([])
  const lastError = ref<StompErrorPayload | null>(null)

  function handleChatFrame(body: string) {
    try {
      const msg = JSON.parse(body) as ChatMessage
      messages.value = [...messages.value, msg]
    } catch {
      // 파싱 실패한 프레임은 무시(형식 오류 방어)
    }
  }

  function handleGameFrame(body: string) {
    try {
      const event = JSON.parse(body) as GameEvent
      gameEvents.value = [...gameEvents.value, event]
    } catch {
      // 무시
    }
  }

  function handleErrorFrame(body: string) {
    try {
      const err = JSON.parse(body) as StompErrorPayload
      // /user/queue/errors는 시그널과 공용 — 채팅/게임 제안/게임 세션 발신 경로만 걸러낸다.
      if (
        err.path?.endsWith('/chat') ||
        err.path?.endsWith('/game-suggest') ||
        err.path?.includes('/game/')
      ) {
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
    gameEvents.value = []
    lastError.value = null

    return new Promise((resolve) => {
      const c = new Client({
        brokerURL: resolveBrokerUrl(),
        reconnectDelay: 3000,
        // 운영 빌드에서는 no-op — undefined를 넘기면 Object.assign이 기본 no-op debug를 덮어써 연결이 죽는다.
        debug: import.meta.env.DEV ? (msg) => console.debug('[STOMP]', msg) : () => {},
        beforeConnect: () => {
          // 재연결마다 최신 accessToken으로 갱신 — 만료 토큰으로 재연결하면 CONNECT가 거부된다.
          c.connectHeaders = { Authorization: `Bearer ${getAccessToken() ?? ''}` }
        },
        onConnect: () => {
          connected.value = true
          chatSub = c.subscribe(`/topic/rooms/${roomId}/chat`, (frame) => handleChatFrame(frame.body))
          gameSub = c.subscribe(`/topic/rooms/${roomId}/game`, (frame) => handleGameFrame(frame.body))
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
    gameSub?.unsubscribe()
    errorSub?.unsubscribe()
    chatSub = null
    gameSub = null
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

  // ── 게임 세션 발신 (S15P11A706-115) ──────────
  /** 게임 시작(방장 전용 — 서버가 방장 검증). 수리되면 GAME_START가 방 전체에 배포된다. */
  function startGame(gameId: number, constellationKey?: string) {
    if (!client?.connected || !currentRoomId) return
    client.publish({
      destination: `/app/rooms/${currentRoomId}/game/start`,
      body: JSON.stringify({ gameId, constellationKey: constellationKey ?? null }),
    })
  }

  /** 라운드 진행 상황 발신 — 호출부에서 2~5Hz로 스로틀할 것(프레임마다 금지). */
  function sendGameProgress(starsLit: number, holdProgress: number) {
    if (!client?.connected || !currentRoomId) return
    client.publish({
      destination: `/app/rooms/${currentRoomId}/game/progress`,
      body: JSON.stringify({ starsLit, holdProgress }),
    })
  }

  /** 라운드 최종 결과 발신 — 참가자당 1회만 수리된다(재전송은 서버가 무시). */
  function sendGameFinish(score: number, starsHit: number) {
    if (!client?.connected || !currentRoomId) return
    client.publish({
      destination: `/app/rooms/${currentRoomId}/game/finish`,
      body: JSON.stringify({ score, starsHit }),
    })
  }

  onScopeDispose(disconnect)

  return {
    connected: readonly(connected),
    messages,
    gameEvents,
    lastError,
    connect,
    disconnect,
    sendChat,
    suggestGame,
    startGame,
    sendGameProgress,
    sendGameFinish,
  }
}
