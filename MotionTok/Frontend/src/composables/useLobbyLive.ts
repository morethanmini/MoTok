/**
 * 로비 실시간 수신 라우터 — 전역 STOMP 연결(-142) 위의 로비용 구독을 한곳에 모은다.
 *
 * 대체하는 것: `useAutoReload` 12초 폴링 4종(방 목록·친구 목록·친구 요청 배지·받은 초대).
 * 그 폴링은 응답의 거의 전부가 "아무것도 안 바뀜"이었고, 부하가 이벤트 수가 아니라
 * 접속자 수 × 주기에 비례했다.
 *
 * ## 스냅샷 + 델타
 * 실시간 채널은 **변화만** 전달한다. 그래서 화면 진입 시의 REST 1회 조회는 그대로 남고,
 * 연결이 끊겼다 다시 붙을 때마다 `onResync`로 그 조회를 한 번 더 돌린다 —
 * STOMP는 끊겨 있던 동안의 이벤트를 되돌려주지 않으므로 이 재동기화가 없으면
 * 네트워크가 한 번 흔들릴 때마다 화면이 조용히 낡는다.
 *
 * ## 방 목록 델타를 반영해도 되는 때
 * 목록은 "최신순 6개 페이지"라(-124) 방 하나가 생기면 전 페이지가 한 칸씩 밀린다.
 * 그래서 델타를 그대로 적용해도 되는 건 **1페이지이고 검색 중이 아닐 때**뿐이다.
 * 그 밖에서는 무시하고 기존 REST 흐름을 그대로 둔다 — 2페이지에서 1페이지의 변화를
 * 반영해 봐야 지금 보는 목록과 무관하고, 검색 조건은 서버가 알지도 못한다.
 * 방이 닫혀 카드가 한 장 모자라게 되면 그때만 재조회한다(그 시점의 로비 체류자만,
 * 그것도 서버가 1초로 모아 보낸 뒤라 몰려도 감당 가능한 양이다).
 */
import { onBeforeUnmount } from 'vue'
import type {
  LobbyRoomEvent,
  PresenceQueueMessage,
  UserNotification,
} from '@/api/types'
import { isMemberSession, onStompConnected, subscribeGlobal } from './useGlobalStomp'

const LOBBY_ROOMS_TOPIC = '/topic/lobby/rooms'
const PRESENCE_QUEUE = '/user/queue/presence'
const NOTIFICATIONS_QUEUE = '/user/queue/notifications'

export interface LobbyLiveHandlers {
  /** 방 변화 배치 한 묶음. 서버가 1초 창으로 모아 보내므로 배열이다. */
  onRoomEvents?: (events: LobbyRoomEvent[]) => void
  /** 친구 한 명의 접속 상태 변화. */
  onFriendPresence?: (event: { userId: number; presence: string; currentRoomId: string | null }) => void
  /** 방 초대·친구 요청 알림. */
  onNotification?: (notification: UserNotification) => void
  /** 연결이 (재)성립했다 — REST 스냅샷을 다시 받을 자리. */
  onResync?: () => void
}

function parse<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T
  } catch {
    return null // 형식 오류 프레임은 조용히 버린다
  }
}

export function useLobbyLive(handlers: LobbyLiveHandlers) {
  const disposers: Array<() => void> = []

  // 게스트도 전역 연결은 열지만(1인방 게임 이벤트) 로비·친구 채널의 대상은 아니다.
  // 서버가 회원 전용 토픽 구독을 거절하며 연결을 끊으므로, 애초에 구독하지 않는다.
  if (!isMemberSession()) {
    return
  }

  if (handlers.onRoomEvents) {
    disposers.push(
      subscribeGlobal(LOBBY_ROOMS_TOPIC, (body) => {
        const events = parse<LobbyRoomEvent[]>(body)
        if (Array.isArray(events) && events.length > 0) handlers.onRoomEvents!(events)
      }),
    )
  }

  if (handlers.onFriendPresence) {
    disposers.push(
      subscribeGlobal(PRESENCE_QUEUE, (body) => {
        const message = parse<PresenceQueueMessage>(body)
        // 같은 큐로 하트비트 간격 정정(BEAT)도 온다 — 그건 usePresenceHeartbeat의 몫이다.
        if (!message || message.type !== 'FRIEND' || message.userId == null || !message.presence) return
        handlers.onFriendPresence!({
          userId: message.userId,
          presence: message.presence,
          currentRoomId: message.currentRoomId,
        })
      }),
    )
  }

  if (handlers.onNotification) {
    disposers.push(
      subscribeGlobal(NOTIFICATIONS_QUEUE, (body) => {
        const notification = parse<UserNotification>(body)
        if (notification?.type) handlers.onNotification!(notification)
      }),
    )
  }

  if (handlers.onResync) {
    disposers.push(onStompConnected(handlers.onResync))
  }

  onBeforeUnmount(() => disposers.forEach((dispose) => dispose()))
}
