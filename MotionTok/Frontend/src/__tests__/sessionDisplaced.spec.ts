/**
 * 단일 세션 — 다른 곳에서 로그인하면 이 세션이 밀려난다 (useSessionDisplaced).
 *
 * 개인 큐 하나로 초대·친구요청·밀림이 함께 흐르므로 타입을 정확히 갈라야 하고,
 * 무엇보다 <b>내가 방금 한 로그인에 내가 튕기면 안 된다</b> — 같은 탭에서 재로그인하면
 * 아직 열려 있는 내 소켓에도 알림이 오기 때문이다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const handlers = new Map<string, (body: string) => void>()

// STOMP 연결 없이 프레임만 흘려보낸다 — 검증 대상은 알림 해석이지 전송 계층이 아니다.
vi.mock('@/composables/useGlobalStomp', () => ({
  subscribeGlobal: (destination: string, handler: (body: string) => void) => {
    handlers.set(destination, handler)
    return () => handlers.delete(destination)
  },
  isMemberSession: () => memberSession,
}))

let memberSession = true

const { useSessionDisplaced } = await import('../composables/useSessionDisplaced')
const { onSessionExpired } = await import('../api/authEvents')
const { clearTokens, setAccessToken } = await import('../api/token')

/** iat을 원하는 시점으로 둔 가짜 회원 토큰 — "방금 로그인했는가" 판정이 여기서 갈린다. */
function memberJwt(issuedSecondsAgo: number) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '1', type: 'member', iat: now - issuedSecondsAgo, exp: now + 3600 }
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `header.${b64}.signature`
}

function push(notification: unknown) {
  handlers.get('/user/queue/notifications')?.(JSON.stringify(notification))
}

describe('세션 밀림 알림', () => {
  let ended: ReturnType<typeof vi.fn<(reason: string) => void>>
  let unsubscribeEvent: () => void
  let unsubscribeQueue: () => void

  beforeEach(() => {
    memberSession = true
    handlers.clear()
    clearTokens()
    ended = vi.fn<(reason: string) => void>()
    unsubscribeEvent = onSessionExpired(ended)
    unsubscribeQueue = useSessionDisplaced()
  })

  afterEach(() => {
    unsubscribeEvent()
    unsubscribeQueue()
  })

  it('SESSION_DISPLACED를 받으면 세션 종료를 알린다', () => {
    setAccessToken(memberJwt(600)) // 10분 전에 로그인해 둔 세션

    push({ type: 'SESSION_DISPLACED', payload: null })

    expect(ended).toHaveBeenCalledWith('displaced')
  })

  it('같은 큐의 다른 알림은 건드리지 않는다', () => {
    setAccessToken(memberJwt(600))

    push({ type: 'ROOM_INVITATION', payload: { roomId: 'r1' } })
    push({ type: 'FRIEND_REQUEST', payload: null })
    push({ type: 'FRIEND_LIST_CHANGED', payload: null })

    expect(ended).not.toHaveBeenCalled()
  })

  it('방금 내가 한 로그인 때문이라면 무시한다 — 같은 탭 재로그인에 스스로 튕기지 않는다', () => {
    setAccessToken(memberJwt(1)) // 1초 전 발급 = 이 알림을 부른 로그인이 곧 나

    push({ type: 'SESSION_DISPLACED', payload: null })

    expect(ended).not.toHaveBeenCalled()
  })

  it('게스트에게는 해당 없다', () => {
    memberSession = false
    setAccessToken(memberJwt(600))

    push({ type: 'SESSION_DISPLACED', payload: null })

    expect(ended).not.toHaveBeenCalled()
  })

  it('형식이 깨진 프레임은 조용히 버린다', () => {
    setAccessToken(memberJwt(600))

    handlers.get('/user/queue/notifications')?.('not-json')

    expect(ended).not.toHaveBeenCalled()
  })
})
