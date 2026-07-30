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
import { onBeforeUnmount, onMounted } from 'vue'
import type {
  LobbyRoomEvent,
  PresenceQueueMessage,
  UserNotification,
} from '@/api/types'
import { isMemberSession, onStompConnected, subscribeGlobal } from './useGlobalStomp'

const LOBBY_ROOMS_TOPIC = '/topic/lobby/rooms'
const PRESENCE_QUEUE = '/user/queue/presence'
const NOTIFICATIONS_QUEUE = '/user/queue/notifications'

/** 복귀 재조회의 최소 간격. focus와 visibilitychange가 거의 동시에 오는 브라우저가 있다. */
const RESYNC_MIN_GAP_MS = 10_000

/**
 * 재연결 재조회를 흩는 폭(ms). 0~이 값 사이에서 무작위로 미룬다.
 *
 * <p>끊김이 서버발이면 접속자 <b>전원</b>이 거의 같은 순간에 다시 붙는다. 붙자마자 재조회를 돌리면
 * REST 여러 발이 한꺼번에 나가 재연결 직후에 2차 스파이크가 생긴다 — 소켓은 살아났는데 그 직후
 * API가 밀리는 모양이다. STOMP 재연결 자체에도 지터가 있지만(useGlobalStomp) 붙은 <b>뒤</b>의
 * 조회는 별개라 여기서 한 번 더 흩는다.</p>
 *
 * <p>사용자 체감은 "재접속 후 목록이 최대 3초 늦게 맞춰짐"인데, 그 사이 도착하는 델타는 그대로
 * 반영되므로 실제로 낡아 보이는 창은 훨씬 짧다.</p>
 */
const RESYNC_JITTER_MS = 3_000

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
  //
  // 이 판정은 setup 때 한 번뿐이라, 통과하지 못하면 그 화면 수명 내내 실시간이 죽는다.
  // 라우터 가드가 회원을 보장하는 화면에서만 쓰이므로 정상 경로에서는 걸리지 않지만,
  // 걸렸을 때 아무 흔적이 없으면 "방 목록만 실시간, 친구만 정지" 같은 반쪽 상태를 설명할 수 없다.
  if (!isMemberSession()) {
    if (import.meta.env.DEV) {
      console.warn('[로비 실시간] 회원 세션이 아니라 구독을 건너뜁니다 — 게스트이거나 토큰이 만료됐습니다')
    }
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
    const resync = handlers.onResync

    // 재연결 재조회는 지터를 두고 미룬다(RESYNC_JITTER_MS 주석 참고).
    // 타이머는 하나만 살려 둔다 — 재연결이 연달아 일어나도 조회가 겹쳐 쌓이면 안 되고,
    // 화면을 떠난 뒤 뒤늦게 돌아 죽은 핸들러를 건드리는 것도 막아야 한다.
    let resyncTimer: ReturnType<typeof setTimeout> | undefined
    disposers.push(
      onStompConnected(() => {
        clearTimeout(resyncTimer)
        resyncTimer = setTimeout(resync, Math.random() * RESYNC_JITTER_MS)
      }),
    )
    disposers.push(() => clearTimeout(resyncTimer))

    // 탭이 다시 보일 때 한 번 — 폴링이 아니라 <b>구멍 메우기</b>다.
    //
    // 델타만으로 목록을 유지하면 서버가 이벤트를 못 낸 구간이 영구히 남는다. 대표적으로
    // presence 키가 TTL로 조용히 사라지는 경우(친구가 절전에 들어가거나 탭이 백그라운드로
    // 오래 있거나 망이 끊긴 경우)에는 발행할 주체가 아무도 없어 그 친구는 접속 중으로 박제된다.
    // 예전 폴링이 visibilitychange·focus에서 겸하던 일이 정확히 이것이라, 주기는 버리고
    // 이 한 조각만 되살린다 — 사용자가 화면으로 돌아오는 순간에만 1회.
    let lastResyncAt = 0
    const resyncIfStale = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastResyncAt < RESYNC_MIN_GAP_MS) return
      lastResyncAt = now
      resync()
    }

    onMounted(() => {
      document.addEventListener('visibilitychange', resyncIfStale)
      window.addEventListener('focus', resyncIfStale)
    })
    disposers.push(() => {
      document.removeEventListener('visibilitychange', resyncIfStale)
      window.removeEventListener('focus', resyncIfStale)
    })
  }

  onBeforeUnmount(() => disposers.forEach((dispose) => dispose()))
}
