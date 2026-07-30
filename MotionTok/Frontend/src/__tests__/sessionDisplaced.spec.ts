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
const { onSessionExpired, markOwnLoginStarted } = await import('../api/authEvents')
const { clearTokens, setAccessToken } = await import('../api/token')

/** 가짜 회원 토큰. 밀림 판정은 이제 토큰이 아니라 "내가 로그인을 시작했는가"로 갈린다. */
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
    // "방금 로그인했는가" 표시는 모듈 전역이라 테스트 사이에 남는다.
    // 시계를 고정한 뒤 표시를 창 밖으로 밀어내 매번 같은 출발점에서 시작한다.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    markOwnLoginStarted()
    vi.advanceTimersByTime(60_000)

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
    vi.useRealTimers()
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
    setAccessToken(memberJwt(600))
    markOwnLoginStarted() // 로그인 요청을 막 보냈다

    push({ type: 'SESSION_DISPLACED', payload: null })

    expect(ended).not.toHaveBeenCalled()
  })

  // 이 버그로 로그인이 한 번씩 튕겼다: 서버는 로그인 처리 중에 알림을 보내므로, 그 프레임이
  // 로그인 응답보다 먼저 도착할 수 있다. 그 순간 내 토큰은 아직 '옛 것'이라 발급 시각으로
  // 판정하면 "내 로그인이 아니다"가 되어 스스로 튕겼다. 판정 근거를 요청 시작 시점으로 옮겼다.
  it('알림이 로그인 응답보다 먼저 도착해도 무시한다 — 토큰이 아직 옛 것이어도', () => {
    setAccessToken(memberJwt(600)) // 아직 교체 전인 옛 세션의 토큰
    markOwnLoginStarted() // 요청은 보냈고 응답은 아직 안 왔다

    push({ type: 'SESSION_DISPLACED', payload: null })

    expect(ended).not.toHaveBeenCalled()
  })

  it('로그인한 지 오래됐으면 정상적으로 밀린다 — 진짜 다른 곳 로그인은 막지 않는다', () => {
    setAccessToken(memberJwt(600))
    markOwnLoginStarted()
    vi.advanceTimersByTime(60_000) // 창을 한참 넘겼다

    push({ type: 'SESSION_DISPLACED', payload: null })

    expect(ended).toHaveBeenCalledWith('displaced')
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
