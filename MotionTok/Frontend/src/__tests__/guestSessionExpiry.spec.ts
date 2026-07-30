/**
 * 게스트 세션 만료 안내 (refreshScheduler + authEvents).
 *
 * 게스트에겐 Refresh 쿠키가 없어 액세스 토큰이 만료되는 순간이 곧 세션의 끝이다.
 * REST 요청이 뜸한 게임 중에는 401조차 늦게 오므로, 타이머가 만료 시점을 직접 짚어 줘야
 * "아무 안내 없이 갑자기 안 되는" 상태가 생기지 않는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { rescheduleTokenAutoRefresh, stopTokenAutoRefresh } from '../api/refreshScheduler'
import { onSessionExpired } from '../api/authEvents'
import { clearTokens, guestSessionMinutes, setAccessToken, setGuestAccessToken } from '../api/token'

/** iat/exp까지 담은 가짜 JWT — 게스트 이용 시간(분)은 이 둘의 차이에서 나온다. */
function fakeJwt(lifetimeSec: number, remainingSec: number, type: 'member' | 'guest' = 'guest') {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '1', type, iat: now + remainingSec - lifetimeSec, exp: now + remainingSec }
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `header.${b64}.signature`
}

describe('게스트 세션 만료', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearTokens()
  })

  afterEach(() => {
    stopTokenAutoRefresh()
    vi.useRealTimers()
  })

  it('토큰이 만료되는 순간 세션 종료를 알린다', () => {
    const ended = vi.fn()
    const unsubscribe = onSessionExpired(ended)
    setGuestAccessToken(fakeJwt(1800, 1800)) // 30분짜리, 방금 발급
    rescheduleTokenAutoRefresh()

    vi.advanceTimersByTime(29 * 60 * 1000)
    expect(ended).not.toHaveBeenCalled() // 아직 살아 있다

    vi.advanceTimersByTime(60 * 1000)
    expect(ended).toHaveBeenCalledWith('guest')
    unsubscribe()
  })

  it('이미 만료된 토큰을 들고 있으면 곧바로 알린다', () => {
    const ended = vi.fn()
    const unsubscribe = onSessionExpired(ended)
    setGuestAccessToken(fakeJwt(1800, -10))
    rescheduleTokenAutoRefresh()

    vi.advanceTimersByTime(0)
    expect(ended).toHaveBeenCalledWith('guest')
    unsubscribe()
  })

  it('회원 세션은 이 타이머로 끝나지 않는다 — 갱신 대상이다', () => {
    const ended = vi.fn()
    const unsubscribe = onSessionExpired(ended)
    setAccessToken(fakeJwt(3600, 1, 'member'))
    rescheduleTokenAutoRefresh()

    vi.advanceTimersByTime(60 * 1000)
    expect(ended).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('안내 문구에 쓸 이용 시간은 토큰에서 읽는다 — 서버 설정이 바뀌면 문구도 따라간다', () => {
    setGuestAccessToken(fakeJwt(1800, 1800))
    expect(guestSessionMinutes()).toBe(30)

    setGuestAccessToken(fakeJwt(43200, 43200))
    expect(guestSessionMinutes()).toBe(720)

    setAccessToken(fakeJwt(3600, 3600, 'member'))
    expect(guestSessionMinutes()).toBeNull() // 회원은 해당 없음
  })
})
