/**
 * 액세스 토큰 자동 갱신 (http.ts).
 * 세션 하나가 30분을 넘기는 서비스라, "요청이 없어도 만료된다 / 만료돼도 이어져야 한다"가 핵심 계약이다.
 *
 * Refresh 토큰은 HttpOnly 쿠키라 코드가 값을 들고 있지 않다. 그래서 여기서 검증하는 것은
 * "언제 갱신을 시도하는가"와 "본문 없이 쿠키만으로 부르는가"다 — 쿠키 자체는 브라우저·서버의 몫.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { http, forceRefreshAccessToken, restoreSessionFromCookie } from '../api/http'
import { onSessionExpired } from '../api/authEvents'
import { clearTokens, getAccessToken, setAccessToken, setGuestAccessToken } from '../api/token'

/** type/exp 클레임만 담은 가짜 JWT — 프론트는 서명을 검증하지 않으므로 헤더·서명은 더미로 둔다. */
function fakeJwt(expiresInSec: number, type: 'member' | 'guest' = 'member') {
  const payload = { sub: '1', type, exp: Math.floor(Date.now() / 1000) + expiresInSec }
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `header.${b64}.signature`
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 갱신 응답 — 넉넉한 만료의 새 액세스 토큰. 회전된 refresh는 Set-Cookie로만 오므로 본문에 없다. */
function refreshPayload(accessToken = fakeJwt(3600)) {
  return { tokenType: 'Bearer', accessToken, expiresIn: 3600 }
}

const fetchMock = vi.fn<typeof fetch>()

/** 갱신 호출만 골라낸다. */
function refreshCalls() {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/auth/token/refresh'))
}

describe('액세스 토큰 자동 갱신', () => {
  beforeEach(() => {
    clearTokens()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('만료가 임박하면 요청 전에 미리 갱신하고 새 토큰으로 보낸다', async () => {
    setAccessToken(fakeJwt(60)) // 남은 1분 < 선제 갱신 기준(5분)
    const rotated = fakeJwt(3600)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, refreshPayload(rotated)))
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }))

    await http.get('/users/me')

    const [refreshUrl] = fetchMock.mock.calls[0] ?? []
    expect(String(refreshUrl)).toContain('/auth/token/refresh')

    const [, meInit] = fetchMock.mock.calls[1] ?? []
    expect((meInit?.headers as Record<string, string> | undefined)?.Authorization).toBe(`Bearer ${rotated}`)
    expect(getAccessToken()).toBe(rotated)
  })

  it('갱신 요청은 본문 없이 쿠키만으로 보낸다', async () => {
    setAccessToken(fakeJwt(60))
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, refreshPayload()))
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }))

    await http.get('/users/me')

    const [, init] = refreshCalls()[0] ?? []
    expect(init?.body).toBeUndefined()
    expect(init?.credentials).toBe('include')
  })

  it('만료가 멀면 갱신하지 않는다', async () => {
    setAccessToken(fakeJwt(3600))
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 1 }))

    await http.get('/users/me')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/users/me')
  })

  it('401이면 한 번 갱신하고 원래 요청을 재시도한다', async () => {
    setAccessToken(fakeJwt(3600)) // 선제 갱신에는 안 걸리는 토큰
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'COMMON_UNAUTHORIZED' }))
      .mockResolvedValueOnce(jsonResponse(200, refreshPayload()))
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }))

    await expect(http.get('/users/me')).resolves.toEqual({ id: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('서버가 갱신을 거절하면 토큰을 지우고 세션 만료를 알린다', async () => {
    setAccessToken(fakeJwt(3600))
    const expired = vi.fn<() => void>()
    const unsubscribe = onSessionExpired(expired)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'COMMON_UNAUTHORIZED' }))
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_INVALID_TOKEN' }))

    await expect(http.get('/users/me')).rejects.toMatchObject({ status: 401 })
    expect(expired).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
    unsubscribe()
  })

  // 단일 세션(v0.2.25) — 다른 곳 로그인으로 밀려난 세션은 서버가 갱신을 전용 코드로 거절한다.
  // 일반 만료('member')와 사유가 갈려야 "다른 곳에서 로그인했어요" 안내가 뜬다(App.vue).
  it('밀려난 세션(AUTH_SESSION_DISPLACED)은 displaced 사유로 세션 종료를 알린다', async () => {
    setAccessToken(fakeJwt(3600))
    const expired = vi.fn<(reason: string) => void>()
    const unsubscribe = onSessionExpired(expired)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_SESSION_DISPLACED' }))
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_SESSION_DISPLACED' }))

    await expect(http.get('/users/me')).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_SESSION_DISPLACED',
    })
    expect(expired).toHaveBeenCalledTimes(1)
    expect(expired).toHaveBeenCalledWith('displaced')
    expect(getAccessToken()).toBeNull()
    unsubscribe()
  })

  // 액세스 토큰을 30분으로 줄이면서 갱신 횟수가 두 배가 됐다 — 순간적인 네트워크 끊김에
  // 로그아웃시키면 지하철에서 게임하다 튕기는 일이 그만큼 잦아진다. 쿠키는 멀쩡하므로 다음 시도에 맡긴다.
  it('네트워크가 끊겨 갱신하지 못한 것은 세션 종료로 보지 않는다', async () => {
    const token = fakeJwt(3600)
    setAccessToken(token)
    const expired = vi.fn<() => void>()
    const unsubscribe = onSessionExpired(expired)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'COMMON_UNAUTHORIZED' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(http.get('/users/me')).rejects.toMatchObject({ status: 401 })
    expect(expired).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe(token) // 세션 유지 — 다음 갱신 시도가 살린다
    unsubscribe()
  })

  it('동시에 여러 요청이 401이어도 갱신은 한 번만 돈다', async () => {
    setAccessToken(fakeJwt(3600))
    fetchMock.mockImplementation((url) => {
      const href = String(url)
      if (href.includes('/auth/token/refresh')) return Promise.resolve(jsonResponse(200, refreshPayload()))
      // 첫 호출(옛 토큰)은 401, 갱신 후 호출은 200
      const authorized = getAccessToken() !== null && href.includes('/users/')
      return Promise.resolve(
        authorized && refreshCalls().length > 0
          ? jsonResponse(200, { ok: true })
          : jsonResponse(401, { code: 'COMMON_UNAUTHORIZED' }),
      )
    })

    await Promise.all([http.get('/users/me'), http.get('/users/1')])

    expect(refreshCalls()).toHaveLength(1)
  })

  // 닉네임 변경처럼 토큰 name 클레임이 바뀌는 경우 — 만료가 멀어도 즉시 회전해야
  // 서버(방 참가·채팅 표시명)가 옛 클레임(pending_*)을 계속 읽지 않는다.
  it('강제 갱신은 만료가 멀어도 즉시 토큰을 회전시킨다', async () => {
    setAccessToken(fakeJwt(3600))
    const rotated = fakeJwt(3600)
    fetchMock.mockResolvedValueOnce(jsonResponse(200, refreshPayload(rotated)))

    await forceRefreshAccessToken()

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/auth/token/refresh')
    expect(getAccessToken()).toBe(rotated)
  })

  it('강제 갱신도 게스트(Refresh 쿠키 없음)는 그냥 지나간다', async () => {
    setGuestAccessToken(fakeJwt(3600, 'guest'))

    await forceRefreshAccessToken()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('게스트(Refresh 쿠키 없음)는 갱신을 시도하지 않는다', async () => {
    setGuestAccessToken(fakeJwt(60, 'guest'))
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 'COMMON_UNAUTHORIZED' }))

    await expect(http.get('/users/me')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// 회원 액세스 토큰은 메모리에만 있다 — 새로고침하면 사라지고, 쿠키가 유일한 복원 수단이다.
describe('새로고침 복원', () => {
  beforeEach(() => {
    clearTokens()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('쿠키가 살아 있으면 토큰 없이도 세션을 되살린다', async () => {
    const restoredToken = fakeJwt(3600)
    fetchMock.mockResolvedValueOnce(jsonResponse(200, refreshPayload(restoredToken)))

    await expect(restoreSessionFromCookie()).resolves.toBe(true)
    expect(getAccessToken()).toBe(restoredToken)
  })

  it('로그인한 적 없는 방문자에게 "세션 만료"를 띄우지 않는다', async () => {
    const expired = vi.fn<() => void>()
    const unsubscribe = onSessionExpired(expired)
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_INVALID_TOKEN' }))

    await expect(restoreSessionFromCookie()).resolves.toBe(false)
    expect(expired).not.toHaveBeenCalled()
    unsubscribe()
  })

  // 밀려난 뒤 새로고침한 경우 — 조용한 복원 경로라도 displaced는 안내한다.
  // 이 코드는 세션이 실재했다는 증거라, 방문자의 조용한 실패와 같은 취급이면 계정 도용을 놓친다.
  it('밀려난 세션은 조용한 복원에서도 displaced 안내를 띄운다', async () => {
    const expired = vi.fn<(reason: string) => void>()
    const unsubscribe = onSessionExpired(expired)
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_SESSION_DISPLACED' }))

    await expect(restoreSessionFromCookie()).resolves.toBe(false)
    expect(expired).toHaveBeenCalledTimes(1)
    expect(expired).toHaveBeenCalledWith('displaced')
    unsubscribe()
  })

  it('게스트는 복원을 시도하지 않는다', async () => {
    setGuestAccessToken(fakeJwt(3600, 'guest'))

    await expect(restoreSessionFromCookie()).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
