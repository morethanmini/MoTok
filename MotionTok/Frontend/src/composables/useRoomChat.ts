/**
 * 대기실 채팅 + 게임 제안 + 게임 세션 이벤트 컴포저블 (STOMP over WebSocket).
 *
 * ## 연결을 더 이상 소유하지 않는다 (-142)
 * 예전에는 이 컴포저블이 방에 들어갈 때마다 소켓을 새로 열고 나갈 때 닫았다. 로그인 직후부터
 * 전역 연결(useGlobalStomp) 하나가 계속 살아 있는 지금은 <b>구독만 붙였다 뗀다</b>.
 * 그대로 뒀다면 게임방에 들어가는 순간 소켓이 두 개가 됐을 것이다.
 *
 * 그래서 `connect`/`disconnect`의 의미가 "연결/해제"에서 "방 입장/퇴장"으로 바뀌었다 —
 * 이름은 호출부 호환을 위해 유지한다. 서버도 이 전환에 맞춰 방 재실 판정을
 * DISCONNECT뿐 아니라 UNSUBSCRIBE로도 하도록 고쳤다(RoomPresenceTracker).
 *
 * 흐름: connect(roomId) → /topic/rooms/{roomId}/chat + /topic/rooms/{roomId}/game 구독
 *      + /user/queue/errors 구독(내 에러만).
 * 발신은 REST가 아니라 STOMP publish — 자기 메시지도 topic으로 에코되어 돌아오므로,
 * 발신 시 로컬에 미리 추가하지 않고 수신 시에만 append한다.
 *
 * 뷰에서의 사용 (예):
 *   const chat = useRoomChat()
 *   await chat.connect(roomId)
 *   chat.sendChat('안녕하세요')
 *   chat.startGame(1)               // 방장 — 서버가 GAME_START를 방 전체에 배포
 *   watch(chat.gameEvents, ...)     // GAME_START/PROGRESS/PLAYER_FINISHED/GAME_END 수신
 */
import { onScopeDispose, shallowRef, ref } from 'vue'
import { publishGlobal, stompConnected, subscribeGlobal } from './useGlobalStomp'
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

const CHAT_MAX_LEN = 500

export function useRoomChat() {
  /** 방 스코프 구독 해제 함수들. 연결 자체는 전역 모듈이 소유한다. */
  let roomSubscriptions: Array<() => void> = []
  let currentRoomId: string | null = null

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

  /**
   * 방 입장 — 전역 연결 위에 이 방의 토픽 4개를 얹는다.
   *
   * 연결을 새로 열지 않으므로 즉시 끝난다. 아직 소켓이 붙기 전이어도 문제없다 —
   * 전역 구독 레지스트리가 등록해 뒀다가 연결이 서면 실제 SUBSCRIBE를 걸고,
   * 재연결 때도 알아서 복구한다. 반환 타입(Promise)은 호출부 호환을 위해 유지한다.
   */
  function connect(roomId: string): Promise<void> {
    disconnect()
    currentRoomId = roomId
    // 방을 옮기면 이전 방의 대화·이벤트가 남아 있으면 안 된다.
    // (연결이 앱 수명만큼 사니 이 초기화는 이제 '입장' 시점의 일이다.)
    messages.value = []
    gameEvents.value = []
    lastError.value = null
    roomUpdated.value = null
    hostChanged.value = null
    memberRemoved.value = null
    memberKicked.value = null

    roomSubscriptions = [
      subscribeGlobal(`/topic/rooms/${roomId}/chat`, handleChatFrame),
      subscribeGlobal(`/topic/rooms/${roomId}/game`, handleGameFrame),
      subscribeGlobal(`/topic/rooms/${roomId}/members`, handleMembersFrame),
      subscribeGlobal('/user/queue/errors', handleErrorFrame),
    ]
    return Promise.resolve()
  }

  /**
   * 방 퇴장 — 구독만 떼고 연결은 남긴다.
   *
   * 서버는 방 채팅 토픽의 UNSUBSCRIBE를 퇴장 신호로 읽는다(RoomPresenceTracker).
   * 여기서 구독을 풀지 않으면 방에 유령 멤버가 남는다.
   */
  function disconnect() {
    roomSubscriptions.forEach((dispose) => dispose())
    roomSubscriptions = []
    currentRoomId = null
  }

  /** 채팅 발신. 로컬 append 없음 — 성공하면 같은 메시지가 구독 중인 topic으로 돌아온다. */
  function sendChat(text: string) {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length > CHAT_MAX_LEN || !currentRoomId) return
    publishGlobal(`/app/rooms/${currentRoomId}/chat`, { text: trimmed })
  }

  /** 게임 제안 발신(비방장). gameId는 카탈로그 id, gameName은 카탈로그 name 그대로. */
  function suggestGame(gameId: number, gameName: string) {
    if (!currentRoomId) return
    publishGlobal(`/app/rooms/${currentRoomId}/game-suggest`, { gameId, gameName })
  }

  // ── 게임 세션 발신 (S15P11A706-115) ──────────
  /** 게임 시작(방장 전용 — 서버가 방장 검증). 수리되면 GAME_START가 방 전체에 배포된다. */
  function startGame(gameId: number, constellationKey?: string, difficulty?: string) {
    if (!currentRoomId) return
    publishGlobal(`/app/rooms/${currentRoomId}/game/start`, {
      gameId,
      constellationKey: constellationKey ?? null,
      difficulty: difficulty ?? null,
    })
  }

  /** 게임④ 출제자 포즈 제출(-86) — 서버가 검증 후 POSE_SET을 방 전체에 배포한다. */
  function sendPoseSubmit(pose: string) {
    if (!currentRoomId) return
    publishGlobal(`/app/rooms/${currentRoomId}/game/pose-submit`, { pose })
  }

  /** 라운드 진행 상황 발신 — 호출부에서 2~5Hz로 스로틀할 것(프레임마다 금지). */
  function sendGameProgress(starsLit: number, holdProgress: number, completedCount = 0) {
    if (!currentRoomId) return
    publishGlobal(`/app/rooms/${currentRoomId}/game/progress`, { starsLit, holdProgress, completedCount })
  }

  /**
   * 라운드 최종 결과 발신 — 참가자당 1회만 수리된다(재전송은 서버가 무시).
   * 핑거 스타(게임①)는 score=매치 총점, completedCount=완성 개수(1순위 승부 기준).
   */
  function sendGameFinish(score: number, starsHit: number, completedCount = 0) {
    if (!currentRoomId) return
    publishGlobal(`/app/rooms/${currentRoomId}/game/finish`, { score, starsHit, completedCount })
  }

  // ── 그림으로 말해요(게임 10, 명세 v0.2.20) ──
  /** 획 연산 배치 발신 — 자기 차례(화가)에만, 100~150ms 배치로. 서버가 DRAW로 재방송한다. */
  function sendGameDraw(seq: number, ops: DrawOp[]) {
    if (!currentRoomId) return
    publishGlobal(`/app/rooms/${currentRoomId}/game/draw`, { seq, ops })
  }

  /** 조기 차례 넘기기 발신 — 서버가 TURN_SKIPPED로 재방송하면 전원이 스케줄을 앞당긴다. */
  function sendGameTurnSkip(turnIndex: number, remainingMs: number) {
    if (!currentRoomId) return
    publishGlobal(`/app/rooms/${currentRoomId}/game/turn-skip`, { turnIndex, remainingMs })
  }

  // AI 채점 결과는 클라이언트가 보내지 않는다 — 서버가 GMS를 호출해 점수까지 계산하고
  // DRAW_RESULT + 협동 GAME_END를 방송한다(REST POST /games/draw/judge, 명세 v0.2.22).

  /**
   * 전용 채널을 쓰는 기능(캐치캐치리듬 등)이 **같은 연결에 올라타기 위한 구멍**.
   * 연결을 하나 더 여는 대신 이 두 함수만 노출한다 — 기능별 목적지·이벤트 타입을 여기에
   * 넣기 시작하면 이 파일이 모든 게임의 집합소가 되므로 도메인 지식은 넘기지 않는다.
   * 전역 연결(-142) 이후로는 연결 전에 구독을 등록해도 되고 재연결 시 자동 복구된다.
   */
  function subscribeRaw(destination: string, onBody: (body: string) => void) {
    // 전역 레지스트리에 등록하므로 연결 전에 불러도 되고 재연결 시 자동 복구된다 —
    // 예전에는 미연결이면 조용히 null을 돌려줘 구독이 사라졌다.
    const dispose = subscribeGlobal(destination, onBody)
    return { unsubscribe: dispose }
  }

  /** @returns 발행 성공 여부 — 미연결이면 false */
  function publishRaw(destination: string, body: unknown): boolean {
    return publishGlobal(destination, body)
  }

  onScopeDispose(disconnect)

  return {
    connected: stompConnected,
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
