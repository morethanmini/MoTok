/**
 * 앱 전역 STOMP 연결 — 로그인하는 순간 열고 로그아웃할 때까지 유지한다(-142).
 *
 * ## 왜 전역인가
 * 지금까지 소켓은 게임룸에 들어간 사람만 열었다(useRoomChat). 그 결과 로비에 앉아 있는
 * 사용자에게 서버가 무언가를 밀어 넣을 통로가 아예 없었고, "남이 바꾸는 데이터"는 전부
 * 주기 폴링으로 긁어 와야 했다 — 방 목록·친구 상태·받은 초대·친구 요청·접속 하트비트까지.
 * 부하가 이벤트 수가 아니라 **접속자 수 × 주기**에 비례하는 구조라, 사람이 늘수록
 * "아무것도 안 바뀜"이라는 응답만 늘었다.
 *
 * 소켓을 하나 더 여는 비용이 걱정이었지만, 어차피 방에 들어가면 열어야 하는 연결이다.
 * 그 시점을 로그인 직후로 앞당기는 것뿐이고, 유휴 상태의 비용은 하트비트 프레임 정도다.
 *
 * ## 모듈 레벨 싱글턴인 이유
 * `useRoomChat`은 호출할 때마다 새 Client를 만드는 팩토리다. 그대로 App에서 부르면
 * 게임룸에 들어가는 순간 소켓이 두 개가 된다. 연결의 소유권을 이 모듈이 갖고,
 * 화면들은 **구독만 등록**한다.
 *
 * ## 구독 레지스트리
 * `subscribe(destination, handler)`는 연결 전에 불러도 된다 — 등록해 두고 연결이 서면
 * 그때 실제 SUBSCRIBE를 건다. 재연결 때도 등록분 전체를 다시 건다. 화면이 연결 타이밍을
 * 신경 쓰지 않아도 되는 것이 전역 연결의 핵심 조건이다.
 *
 * ## 끊긴 동안의 공백은 스냅샷으로 메운다
 * STOMP는 끊겨 있던 사이의 이벤트를 되돌려주지 않는다. 그래서 연결이 (재)성립할 때마다
 * `onConnected` 콜백이 돌고, 화면들은 여기서 REST 스냅샷을 한 번 다시 받는다.
 * 폴링이 부수적으로 해 주던 "놓친 것 메우기"를 이 훅이 대신한다.
 */
import { readonly, ref, watch } from 'vue'
import { Client, type StompSubscription } from '@stomp/stompjs'
import { emitAccountBlocked, type AccountBlockKind } from '@/api/authEvents'
import { API_BASE, refreshAccessTokenIfNeeded } from '@/api/http'
import { getAccessToken, readAccessClaims } from '@/api/token'
import { useSessionStore } from '@/stores/session'
import { recordDisconnect } from './useRum'

/** 재시도 간격의 상한(ms). 죽은 자격이나 죽은 서버를 3초마다 계속 두드리지 않는다. */
const MAX_RECONNECT_DELAY_MS = 60_000
const BASE_RECONNECT_DELAY_MS = 3_000

/**
 * 서버가 제재로 연결을 끊을 때 실어 보내는 종료 코드·사유(UserSanctionService).
 * 1008 = 정책 위반. 정상 종료(1000)로 오면 재연결이 그대로 다시 붙어 버리므로 사유로 구분한다.
 */
const CLOSE_POLICY_VIOLATION = 1008
const CLOSE_REASONS: Record<string, AccountBlockKind> = {
  ACCOUNT_SUSPENDED: 'SUSPENDED',
  ACCOUNT_BANNED: 'BANNED',
}

type FrameHandler = (body: string) => void

let client: Client | null = null
/**
 * 연속 재연결 실패 횟수. 인증 거부(onStompError)와 소켓 종료(onWebSocketClose)를 <b>같이</b> 센다.
 * 따로 세면 서버가 죽어 끊긴 경우는 카운터가 오르지 않아 영원히 기본 간격으로 두드리게 된다.
 */
let reconnectFailures = 0
/** 첫 연결에는 재동기화가 필요 없다 — 화면이 마운트하며 이미 스냅샷을 받는다. */
let everConnected = false

const connected = ref(false)
/** destination → 핸들러들. 같은 목적지를 여러 화면이 구독해도 SUBSCRIBE는 하나만 건다. */
const handlers = new Map<string, Set<FrameHandler>>()
const subscriptions = new Map<string, StompSubscription>()
const connectedCallbacks = new Set<() => void>()

/** 연결 상태 — 화면에서 "실시간 끊김" 표시에 쓴다. */
export const stompConnected = readonly(connected)


/**
 * 브로커 URL. 운영 빌드는 `VITE_API_BASE_URL=/api`라 상대 경로가 들어온다 —
 * 문자열 치환만 하면 `'/ws'`가 되어 연결이 서지 않는다. 반드시 현재 오리진 기준으로 절대화한다.
 */
function resolveBrokerUrl(): string {
  const base = new URL(API_BASE, window.location.origin)
  const path = base.pathname.replace(/\/api\/?$/, '')
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${base.host}${path}/ws`
}

/**
 * 연결 대상 판정 — 회원뿐 아니라 <b>게스트도</b> 연결한다.
 *
 * 게스트는 프레즌스·친구·로비 채널의 대상이 아니지만, 1인방 게임 이벤트를 받으려면 소켓이
 * 필요하다. 예전에는 게임룸이 자기 연결을 따로 열어 이 구분이 필요 없었는데, 연결을 하나로
 * 합치면서 "게스트는 연결하지 않는다"로 두면 게스트의 게임이 통째로 죽는다.
 * 회원 전용 채널은 구독하는 쪽에서 거른다(usePresenceHeartbeat·useLobbyLive).
 */
function hasSession(): boolean {
  return readAccessClaims() !== null
}

/** 회원 전용 채널을 구독·발행해도 되는가 — 게스트가 붙으면 서버가 연결을 끊는다. */
export function isMemberSession(): boolean {
  return readAccessClaims()?.type === 'member'
}

function bindHandlers(destination: string) {
  if (!client?.connected || subscriptions.has(destination)) return
  const sub = client.subscribe(destination, (frame) => {
    // 실시간 기능이 "그냥 안 되는" 상황에서 가장 먼저 알아야 하는 건 프레임이 오긴 오느냐다.
    // 개발 빌드에서만 찍는다 — 운영에서는 초당 수십 프레임이 콘솔을 덮는다.
    if (import.meta.env.DEV) console.debug('[STOMP] ←', destination, frame.body)
    handlers.get(destination)?.forEach((handler) => {
      try {
        handler(frame.body)
      } catch (e) {
        // 핸들러 하나가 던져도 같은 목적지의 다른 구독자는 계속 받아야 한다.
        // 다만 조용히 삼키면 "프레임이 안 왔다"와 "와서 처리하다 터졌다"를 구분할 수 없어
        // 실시간 기능의 디버깅이 불가능해진다 — 삼키되 흔적은 남긴다.
        console.warn('[STOMP] 핸들러 처리 실패', destination, e)
      }
    })
  })
  subscriptions.set(destination, sub)
}

/**
 * 목적지 하나를 구독한다. 연결 전에 불러도 되고, 재연결 시 자동으로 복구된다.
 * @returns 해제 함수 — 마지막 구독자가 빠지면 실제 UNSUBSCRIBE까지 보낸다
 */
export function subscribeGlobal(destination: string, handler: FrameHandler): () => void {
  const set = handlers.get(destination) ?? new Set<FrameHandler>()
  set.add(handler)
  handlers.set(destination, set)
  bindHandlers(destination)

  return () => {
    const current = handlers.get(destination)
    if (!current) return
    current.delete(handler)
    if (current.size > 0) return
    handlers.delete(destination)
    subscriptions.get(destination)?.unsubscribe()
    subscriptions.delete(destination)
  }
}

/** @returns 발행 성공 여부 — 미연결이면 false(호출부가 필요하면 재시도한다) */
export function publishGlobal(destination: string, body: unknown): boolean {
  if (!client?.connected) return false
  client.publish({ destination, body: JSON.stringify(body) })
  return true
}

/**
 * <b>재</b>연결될 때마다 불린다. 끊긴 동안 놓친 것을 REST 스냅샷으로 메우는 자리다.
 *
 * <p>등록 시점에 이미 연결돼 있어도 <b>즉시 부르지 않는다.</b> 화면은 어차피 마운트될 때
 * 자기 데이터를 한 번 불러오므로(useAsyncData), 여기서 또 부르면 같은 요청이 두 벌 나가고
 * 더 나쁘게는 <b>둘 사이에 도착한 실시간 델타를 늦게 온 응답이 덮어쓴다</b> —
 * "실시간으로 바뀌었다가 원래대로 돌아가는" 형태로 보인다.
 * 이 훅의 일은 "처음 채우기"가 아니라 "끊겼다 붙은 뒤 메우기"다.</p>
 *
 * @returns 해제 함수
 */
export function onStompConnected(callback: () => void): () => void {
  connectedCallbacks.add(callback)
  return () => connectedCallbacks.delete(callback)
}

/**
 * 재연결 대기 시간 = 지수 백오프 × 지터(0.5~1.5배).
 *
 * <b>지터가 핵심이다.</b> 백오프만 있으면 간격이 늘어날 뿐 모두가 <i>같은 간격으로</i> 움직여서,
 * 동시에 끊긴 사람들은 계속 동시에 재시도한다 — 재시도 자체가 새로운 스파이크가 된다.
 * 배수를 흔들어야 그 동기화가 깨진다. 서버가 한 번 넘어졌을 때 스스로 일어날 수 있느냐가 여기 달려 있다.
 */
function backoffWithJitter(failures: number): number {
  const base = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** failures, MAX_RECONNECT_DELAY_MS)
  return Math.round(base * (0.5 + Math.random()))
}

function activate() {
  if (client) return
  const c = new Client({
    brokerURL: resolveBrokerUrl(),
    reconnectDelay: BASE_RECONNECT_DELAY_MS,
    // 서버도 10초 하트비트를 협상한다(WebSocketConfig) — 중간 프록시가 유휴 커넥션을 끊는 걸 막는다.
    heartbeatIncoming: 10_000,
    heartbeatOutgoing: 10_000,
    debug: import.meta.env.DEV ? (msg) => console.debug('[STOMP]', msg) : () => {},
    beforeConnect: async () => {
      // 만료된 토큰으로 재연결하면 CONNECT가 거부되고, 3초 뒤 같은 토큰으로 또 시도해 무한 루프가 된다.
      // 절전에서 깨어난 탭이 정확히 이 경로라, 붙이기 전에 갱신부터 한다.
      await refreshAccessTokenIfNeeded().catch(() => {})
      c.connectHeaders = { Authorization: `Bearer ${getAccessToken() ?? ''}` }
    },
    onConnect: () => {
      reconnectFailures = 0
      c.reconnectDelay = backoffWithJitter(0)
      connected.value = true
      handlers.forEach((_, destination) => bindHandlers(destination))
      // 재연결일 때만 재동기화 — 첫 연결은 화면의 초기 로드와 겹쳐 요청이 두 벌 나가고
      // 그 사이 도착한 델타가 늦은 응답에 덮인다.
      if (everConnected) {
        connectedCallbacks.forEach((callback) => callback())
      }
      everConnected = true
    },
    onStompError: () => {
      // CONNECT 거부(토큰 문제 등). 백오프를 늘려 죽은 자격으로 서버를 두드리지 않는다.
      connected.value = false
      reconnectFailures += 1
      c.reconnectDelay = backoffWithJitter(reconnectFailures)
    },
    onWebSocketClose: (event?: CloseEvent) => {
      connected.value = false
      // 끊긴 동안의 구독은 무효다 — 재연결 시 레지스트리에서 다시 건다.
      subscriptions.clear()

      // 서버 재시작·OOM으로 소켓만 끊긴 경우가 여기다. onStompError와 달리 지금까지는 아무것도
      // 하지 않아 간격이 기본값에 머물렀고, 그래서 접속자 전원이 3초마다 함께 몰려들었다.
      reconnectFailures += 1
      c.reconnectDelay = backoffWithJitter(reconnectFailures)
      recordDisconnect() // RUM — 세션 동안 몇 번 끊겼는지가 재연결 스톰의 직접 증거다

      // 제재로 끊긴 연결은 재연결해도 CONNECT에서 다시 거부된다. 그냥 두면 3초마다 실패만 쌓이고
      // 사용자에게는 "실시간이 안 되는" 상태로만 보인다 — 연결을 접고 안내는 App이 맡는다.
      const blockKind = event?.code === CLOSE_POLICY_VIOLATION ? CLOSE_REASONS[event.reason] : undefined
      if (blockKind) {
        deactivate()
        emitAccountBlocked(blockKind)
      }
    },
  })
  client = c
  c.activate()
}

function deactivate() {
  connected.value = false
  everConnected = false // 로그아웃 후 다시 로그인하면 그건 '첫 연결'이다
  subscriptions.clear()
  const c = client
  client = null
  void c?.deactivate()
}

/**
 * App.vue에서 <b>한 번만</b> 호출한다. 회원 세션이 생기면 연결하고 사라지면 끊는다.
 *
 * <p>로그아웃·세션 만료에서 반드시 끊어야 한다 — 서버도 로그아웃 시 소켓을 닫지만,
 * 클라이언트가 살아 있으면 3초마다 재연결을 시도해 실패 요청만 쌓인다.</p>
 */
export function useGlobalStomp() {
  const session = useSessionStore()
  watch(
    // 스토어의 role을 본다 — localStorage 토큰은 반응형이 아니라 로그인 순간을 놓친다.
    // 새로고침 복원(restore)·로그인·로그아웃 세 경로가 모두 role을 거쳐 간다.
    () => session.isAuthenticated && hasSession(),
    (authenticated) => (authenticated ? activate() : deactivate()),
    { immediate: true },
  )
}

