import { describe, it, expect, beforeEach } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

import { requireMember, requireAdmin } from '../router'
import { RouteName } from '../router/routeNames'
import { setTokens, clearTokens } from '../api/token'
import { useLoginRequired } from '../composables/useLoginRequired'
import { useAccessDenied } from '../composables/useAccessDenied'
import { useSessionStore } from '../stores/session'
import type { UserProfile } from '../api/types'

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
    setTokens(fakeJwt('guest'))
    expect(requireMember(memberOnly)).toEqual({ name: RouteName.Start })
  })

  it('만료된 회원 토큰은 막는다', () => {
    setTokens(fakeJwt('member', -10))
    expect(requireMember(memberOnly)).toEqual({ name: RouteName.Start })
  })

  it('형식이 깨진 토큰은 막는다', () => {
    setTokens('not-a-jwt')
    expect(requireMember(memberOnly)).toEqual({ name: RouteName.Start })
  })

  it('유효한 회원 토큰이면 통과한다', () => {
    setTokens(fakeJwt('member'))
    expect(requireMember(memberOnly)).toBe(true)
    expect(message.value).toBe('')
  })

  it('회원 전용이 아닌 라우트는 토큰 없이도 통과한다', () => {
    expect(requireMember(publicPage)).toBe(true)
  })
})

const adminOnly = { meta: { requiresMember: true, requiresAdmin: true } } as unknown as RouteLocationNormalized

function profileWithRole(role: UserProfile['role']): UserProfile {
  return { id: 1, email: null, nickname: '테스터', role, pointBalance: 0, createdAt: '2026-01-01' }
}

const { message: deniedMessage, close: closeDenied } = useAccessDenied()

describe('관리자 전용 라우트 가드', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    closeDenied()
  })

  it('일반 회원은 로비로 돌려보내고 권한 없음 안내를 띄운다', () => {
    useSessionStore().profile = profileWithRole('USER')
    expect(requireAdmin(adminOnly)).toEqual({ name: RouteName.Lobby })
    expect(deniedMessage.value).not.toBe('')
  })

  it('프로필이 없으면(복원 실패 등) 막는다', () => {
    expect(requireAdmin(adminOnly)).toEqual({ name: RouteName.Lobby })
    expect(deniedMessage.value).not.toBe('')
  })

  it('관리자는 통과한다', () => {
    useSessionStore().profile = profileWithRole('ADMIN')
    expect(requireAdmin(adminOnly)).toBe(true)
    expect(deniedMessage.value).toBe('')
  })

  it('관리자 전용이 아닌 라우트는 역할과 무관하게 통과한다', () => {
    expect(requireAdmin(publicPage)).toBe(true)
  })
})
