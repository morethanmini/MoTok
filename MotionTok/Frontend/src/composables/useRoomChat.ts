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
import type {
  ChatMessage,
  DrawOp,
  GameEvent,
  LiveRoomHostChangedEvent,
  LiveRoomMemberKickedEvent,
  LiveRoomMemberRemovedEvent,
  LiveRoomUpdatedEvent,
  StompErrorPayload,
} from '@/api/types'

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
  let membersSub: StompSubscription | null = null
  let currentRoomId: string | null = null

  const connected = ref(false)
  const messages = shallowRef<ChatMessage[]>([])
  const gameEvents = shallowRef<GameEvent[]>([])
  const lastError = ref<StompErrorPayload | null>(null)
  /** 방 정보 수정 알림(-130). 최신 1건만 들고 있으면 되므로 배열이 아니다. */
  const roomUpdated = ref<LiveRoomUpdatedEvent | null>(null)
  /** 방장 변경(-72). 이걸 반영하지 않으면 방장이 나가도 새 방장에게 시작 권한이 안 붙는다. */
  const hostChanged = ref<LiveRoomHostChangedEvent | null>(null)
  /** 퇴장·강퇴 알림(-71, -73). 대상 여부는 뷰에서 현재 사용자 ID와 비교한다. */
  const memberRemoved = ref<LiveRoomMemberRemovedEvent | null>(null)
  /** 강퇴 알림(-73). 사유가 포함되어 대상에게 안내할 수 있다. */
  const memberKicked = ref<LiveRoomMemberKickedEvent | null>(null)

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

  /**
   * /topic/rooms/{roomId}/members 수신. 이 토픽은 퇴장(-71)·방장변경(-72)·강퇴(-73)·
   * 방 정보 수정(-130) 이벤트가 섞여 오는데 판별용 type 필드가 없다 — 이미 배포된 다른
   * 이벤트 계약을 건드리지 않으려고 필드 모양으로 가른다.
   *
   * 각 이벤트를 가르는 고유 필드:
   *  - title + maxPlayers  → LiveRoomUpdatedEvent (-130)
   *  - hostUserId          → LiveRoomHostChangedEvent (-72)
   *  - userId + participantCount → 퇴장(-71)·강퇴(-73)  ← 아직 화면에 반영하지 않음
   *
   * 봉투 규격(type/payload)이 정해지면(-115) 이 필드 추측을 걷어낼 수 있다.
   */
  function handleMembersFrame(body: string) {
    try {
      const msg = JSON.parse(body) as Partial<LiveRoomUpdatedEvent & LiveRoomHostChangedEvent & LiveRoomMemberKickedEvent>
      if (typeof msg.title === 'string' && typeof msg.maxPlayers === 'number') {
        roomUpdated.value = msg as LiveRoomUpdatedEvent
      } else if (typeof msg.hostUserId === 'string') {
        hostChanged.value = msg as LiveRoomHostChangedEvent
      } else if (typeof msg.userId === 'string' && typeof msg.participantCount === 'number' && typeof msg.reason === 'string') {
        memberKicked.value = msg as LiveRoomMemberKickedEvent
      } else if (typeof msg.userId === 'string' && typeof msg.participantCount === 'number') {
        memberRemoved.value = msg as LiveRoomMemberRemovedEvent
      }
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
        err.path?.includes('/game/') ||
        err.path?.includes('/rhythm/')
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
    roomUpdated.value = null
    hostChanged.value = null
    memberRemoved.value = null
    memberKicked.value = null

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
          membersSub = c.subscribe(`/topic/rooms/${roomId}/members`, (frame) => handleMembersFrame(frame.body))
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
    membersSub?.unsubscribe()
    chatSub = null
    gameSub = null
    errorSub = null
    membersSub = null
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
  function startGame(gameId: number, constellationKey?: string, difficulty?: string) {
    if (!client?.connected || !currentRoomId) return
    client.publish({
      destination: `/app/rooms/${currentRoomId}/game/start`,
      body: JSON.stringify({
        gameId,
        constellationKey: constellationKey ?? null,
        difficulty: difficulty ?? null,
      }),
    })
  }

  /** 게임④ 출제자 포즈 제출(-86) — 서버가 검증 후 POSE_SET을 방 전체에 배포한다. */
  function sendPoseSubmit(pose: string) {
    if (!client?.connected || !currentRoomId) return
    client.publish({
      destination: `/app/rooms/${currentRoomId}/game/pose-submit`,
      body: JSON.stringify({ pose }),
    })
  }

  /** 라운드 진행 상황 발신 — 호출부에서 2~5Hz로 스로틀할 것(프레임마다 금지). */
  function sendGameProgress(starsLit: number, holdProgress: number, completedCount = 0) {
    if (!client?.connected || !currentRoomId) return
    client.publish({
      destination: `/app/rooms/${currentRoomId}/game/progress`,
      body: JSON.stringify({ starsLit, holdProgress, completedCount }),
    })
  }

  /**
   * 라운드 최종 결과 발신 — 참가자당 1회만 수리된다(재전송은 서버가 무시).
   * 핑거 스타(게임①)는 score=매치 총점, completedCount=완성 개수(1순위 승부 기준).
   */
  function sendGameFinish(score: number, starsHit: number, completedCount = 0) {
    if (!client?.connected || !currentRoomId) return
    client.publish({
      destination: `/app/rooms/${currentRoomId}/game/finish`,
      body: JSON.stringify({ score, starsHit, completedCount }),
    })
  }

  // ── 그림으로 말해요(게임 10, 명세 v0.2.20) ──
  /** 획 연산 배치 발신 — 자기 차례(화가)에만, 100~150ms 배치로. 서버가 DRAW로 재방송한다. */
  function sendGameDraw(seq: number, ops: DrawOp[]) {
    if (!client?.connected || !currentRoomId) return
    client.publish({
      destination: `/app/rooms/${currentRoomId}/game/draw`,
      body: JSON.stringify({ seq, ops }),
    })
  }

  /** 조기 차례 넘기기 발신 — 서버가 TURN_SKIPPED로 재방송하면 전원이 스케줄을 앞당긴다. */
  function sendGameTurnSkip(turnIndex: number, remainingMs: number) {
    if (!client?.connected || !currentRoomId) return
    client.publish({
      destination: `/app/rooms/${currentRoomId}/game/turn-skip`,
      body: JSON.stringify({ turnIndex, remainingMs }),
    })
  }

  // AI 채점 결과는 클라이언트가 보내지 않는다 — 서버가 GMS를 호출해 점수까지 계산하고
  // DRAW_RESULT + 협동 GAME_END를 방송한다(REST POST /games/draw/judge, 명세 v0.2.22).

  /**
   * 전용 채널을 쓰는 기능(캐치캐치리듬 등)이 **같은 연결에 올라타기 위한 구멍**.
   * 연결을 하나 더 여는 대신 이 두 함수만 노출한다 — 기능별 목적지·이벤트 타입을 여기에
   * 넣기 시작하면 이 파일이 모든 게임의 집합소가 되므로 도메인 지식은 넘기지 않는다.
   * 구독은 연결 성립 후에만 유효하다 — 호출부가 connected를 watch해서 (재)구독할 것.
   */
  function subscribeRaw(destination: string, onBody: (body: string) => void) {
    return client?.subscribe(destination, (frame) => onBody(frame.body)) ?? null
  }

  /** @returns 발행 성공 여부 — 미연결이면 false */
  function publishRaw(destination: string, body: unknown): boolean {
    if (!client?.connected) return false
    client.publish({ destination, body: JSON.stringify(body) })
    return true
  }

  onScopeDispose(disconnect)

  return {
    connected: readonly(connected),
    subscribeRaw,
    publishRaw,
    messages,
    gameEvents,
    lastError,
    roomUpdated,
    hostChanged,
    memberRemoved,
    memberKicked,
    connect,
    disconnect,
    sendChat,
    suggestGame,
    startGame,
    sendPoseSubmit,
    sendGameProgress,
    sendGameFinish,
    sendGameDraw,
    sendGameTurnSkip,
  }
}
