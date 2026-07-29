import { describe, it, expect, beforeEach } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'

import { requireMember } from '../router'
import { RouteName } from '../router/routeNames'
import { setAccessToken, setGuestAccessToken, clearTokens } from '../api/token'
import { useLoginRequired } from '../composables/useLoginRequired'

/** type/exp 클레임만 담은 가짜 JWT — 프론트는 서명을 검증하지 않으므로 헤더·서명은 더미로 둔다. */
function fakeJwt(type: 'member' | 'guest', expiresInSec = 600) {
  const payload = { sub: '1', type, exp: Math.floor(Date.now() / 1000) + expiresInSec }
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `header.${b64}.signature`
}

const memberOnly = { meta: { requiresMember: true } } as unknown as RouteLocationNormalized
const publicPage = { meta: {} } as unknown as RouteLocationNormalized

const { message, close } = useLoginRequired()

describe('회원 전용 라우트 가드', () => {
  beforeEach(() => {
    clearTokens()
    close()
  })

  it('토큰이 없으면(주소창 직접 접근) 시작 화면으로 돌려보낸다', () => {
    expect(requireMember(memberOnly)).toEqual({ name: RouteName.Start })
  })

  it('차단 시 로그인 안내 모달을 띄운다', () => {
    requireMember(memberOnly)
    expect(message.value).not.toBe('')
  })

  it('게스트 토큰으로는 들어갈 수 없다', () => {
    setGuestAccessToken(fakeJwt('guest'))
    expect(requireMember(memberOnly)).toEqual({ name: RouteName.Start })
  })

  it('만료된 회원 토큰은 막는다', () => {
    setAccessToken(fakeJwt('member', -10))
    expect(requireMember(memberOnly)).toEqual({ name: RouteName.Start })
  })

  it('형식이 깨진 토큰은 막는다', () => {
    setAccessToken('not-a-jwt')
    expect(requireMember(memberOnly)).toEqual({ name: RouteName.Start })
  })

  it('유효한 회원 토큰이면 통과한다', () => {
    setAccessToken(fakeJwt('member'))
    expect(requireMember(memberOnly)).toBe(true)
    expect(message.value).toBe('')
  })

  it('회원 전용이 아닌 라우트는 토큰 없이도 통과한다', () => {
    expect(requireMember(publicPage)).toBe(true)
  })
})

// 관리자 전용 라우트 가드 테스트는 adminGuard.spec.ts로 일원화 —
// 판정 근거가 프로필 role → 토큰 role claim(-133)으로 바뀌면서 차단 UX(denyAccess·Lobby) 검증도 그쪽에 있다.
