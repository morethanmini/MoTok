/**
 * 액세스 토큰 자동 갱신 (http.ts).
 * 세션 하나가 30분을 넘기는 서비스라, "요청이 없어도 만료된다 / 만료돼도 이어져야 한다"가 핵심 계약이다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { http } from '../api/http'
import { onSessionExpired } from '../api/authEvents'
import { clearTokens, getAccessToken, setTokens } from '../api/token'

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

/** 갱신 응답 — 넉넉한 만료의 새 액세스 토큰 + 회전된 refresh */
function refreshPayload(accessToken = fakeJwt(3600)) {
  return { tokenType: 'Bearer', accessToken, refreshToken: 'refresh-v2', expiresIn: 3600 }
}

const fetchMock = vi.fn()

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
    setTokens(fakeJwt(60), 'refresh-v1') // 남은 1분 < 선제 갱신 기준(5분)
    const rotated = fakeJwt(3600)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, refreshPayload(rotated)))
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }))

    await http.get('/users/me')

    const [refreshUrl] = fetchMock.mock.calls[0] ?? []
    expect(String(refreshUrl)).toContain('/auth/token/refresh')

    const [, meInit] = fetchMock.mock.calls[1] ?? []
    expect(meInit.headers.Authorization).toBe(`Bearer ${rotated}`)
    expect(getAccessToken()).toBe(rotated)
  })

  it('만료가 멀면 갱신하지 않는다', async () => {
    setTokens(fakeJwt(3600), 'refresh-v1')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 1 }))

    await http.get('/users/me')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/users/me')
  })

  it('401이면 한 번 갱신하고 원래 요청을 재시도한다', async () => {
    setTokens(fakeJwt(3600), 'refresh-v1') // 선제 갱신에는 안 걸리는 토큰
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'COMMON_UNAUTHORIZED' }))
      .mockResolvedValueOnce(jsonResponse(200, refreshPayload()))
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }))

    await expect(http.get('/users/me')).resolves.toEqual({ id: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('갱신에 실패하면 토큰을 지우고 세션 만료를 알린다', async () => {
    setTokens(fakeJwt(3600), 'refresh-dead')
    const expired = vi.fn()
    const unsubscribe = onSessionExpired(expired)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'COMMON_UNAUTHORIZED' }))
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_INVALID_TOKEN' }))

    await expect(http.get('/users/me')).rejects.toMatchObject({ status: 401 })
    expect(expired).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
    unsubscribe()
  })

  it('동시에 여러 요청이 401이어도 갱신은 한 번만 돈다', async () => {
    setTokens(fakeJwt(3600), 'refresh-v1')
    fetchMock.mockImplementation((url: string | URL) => {
      const href = String(url)
      if (href.includes('/auth/token/refresh')) return Promise.resolve(jsonResponse(200, refreshPayload()))
      // 첫 호출(옛 토큰)은 401, 갱신 후 호출은 200
      const authorized = getAccessToken() !== null && href.includes('/users/')
      return Promise.resolve(
        authorized && fetchMock.mock.calls.some((c) => String(c[0]).includes('/auth/token/refresh'))
          ? jsonResponse(200, { ok: true })
          : jsonResponse(401, { code: 'COMMON_UNAUTHORIZED' }),
      )
    })

    await Promise.all([http.get('/users/me'), http.get('/users/1')])

    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/auth/token/refresh'))
    expect(refreshCalls).toHaveLength(1)
  })

  it('게스트(refresh 토큰 없음)는 갱신을 시도하지 않는다', async () => {
    setTokens(fakeJwt(60, 'guest'), undefined, false)
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 'COMMON_UNAUTHORIZED' }))

    await expect(http.get('/users/me')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
