import { describe, it, expect, beforeEach } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'

import { requireAdmin } from '../router'
import { RouteName } from '../router/routeNames'
import { setTokens, clearTokens, readAccessClaims } from '../api/token'
import { useLoginRequired } from '../composables/useLoginRequired'

/** role 클레임까지 담은 가짜 JWT — 프론트는 서명을 검증하지 않는다(routerGuard.spec와 동일 방식). */
function fakeJwt(type: 'member' | 'guest', role?: 'USER' | 'ADMIN', expiresInSec = 600) {
  const payload = { sub: '1', type, role, exp: Math.floor(Date.now() / 1000) + expiresInSec }
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `header.${b64}.signature`
}

const adminOnly = { meta: { requiresAdmin: true } } as unknown as RouteLocationNormalized
const publicPage = { meta: {} } as unknown as RouteLocationNormalized

const { close } = useLoginRequired()

describe('관리자 라우트 가드 (S15P11A706-133)', () => {
  beforeEach(() => {
    clearTokens()
    close()
  })

  it('role 클레임을 토큰에서 읽는다', () => {
    setTokens(fakeJwt('member', 'ADMIN'))
    expect(readAccessClaims()?.role).toBe('ADMIN')
  })

  it('ADMIN role이면 통과한다', () => {
    setTokens(fakeJwt('member', 'ADMIN'))
    expect(requireAdmin(adminOnly)).toBe(true)
  })

  it('일반 회원(USER)은 시작 화면으로 돌려보낸다', () => {
    setTokens(fakeJwt('member', 'USER'))
    expect(requireAdmin(adminOnly)).toEqual({ name: RouteName.Start })
  })

  it('role 클레임이 없는 구 토큰은 막는다 (재로그인 필요)', () => {
    setTokens(fakeJwt('member'))
    expect(requireAdmin(adminOnly)).toEqual({ name: RouteName.Start })
  })

  it('토큰이 없어도 막는다', () => {
    expect(requireAdmin(adminOnly)).toEqual({ name: RouteName.Start })
  })

  it('관리자 전용이 아닌 라우트는 그대로 통과한다', () => {
    expect(requireAdmin(publicPage)).toBe(true)
  })
})
