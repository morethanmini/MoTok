/**
 * 세션 스토어 — 로그인 상태 / 게스트·회원 구분 / 프로필 / JWT 토큰.
 * 프로필 형태는 API 명세서 UserProfile 스키마를 그대로 따른다.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { TokenResponse, UserProfile } from '@/api/auth'
import * as authApi from '@/api/auth'

export type Role = 'guest' | 'member'

const ACCESS_KEY = 'motok.accessToken'
const REFRESH_KEY = 'motok.refreshToken'

export const useSessionStore = defineStore('session', () => {
  const role = ref<Role | null>(null)
  const profile = ref<UserProfile | null>(null)
  const accessToken = ref<string | null>(null)
  const refreshToken = ref<string | null>(null)

  const isAuthenticated = computed(() => role.value !== null)
  const isGuest = computed(() => role.value === 'guest')
  const isMember = computed(() => role.value === 'member')

  /** 로비 헤더 등에 노출되는 사용자 라벨 */
  const userLabel = computed(() =>
    isGuest.value ? 'GUEST · 1인 전용' : `MEMBER · ${profile.value?.nickname ?? 'P1'}`,
  )

  /**
   * 로그인 성공 응답을 세션에 반영한다.
   * rememberMe면 localStorage(재방문 시 자동 로그인), 아니면 sessionStorage(탭 종료 시 소멸).
   */
  function applyToken(res: TokenResponse, rememberMe = false) {
    role.value = 'member'
    profile.value = res.user
    accessToken.value = res.accessToken
    refreshToken.value = res.refreshToken

    const store = rememberMe ? localStorage : sessionStorage
    store.setItem(ACCESS_KEY, res.accessToken)
    store.setItem(REFRESH_KEY, res.refreshToken)
  }

  function loginAsGuest() {
    role.value = 'guest'
    profile.value = null
  }

  /** 로그아웃 — 서버측 Refresh 토큰까지 무효화해야 14일간 남지 않는다. */
  async function logout() {
    if (accessToken.value) {
      try {
        await authApi.logout(accessToken.value)
      } catch {
        // 서버 무효화에 실패해도 로컬 세션은 반드시 정리한다.
      }
    }
    clear()
  }

  function clear() {
    role.value = null
    profile.value = null
    accessToken.value = null
    refreshToken.value = null
    for (const store of [localStorage, sessionStorage]) {
      store.removeItem(ACCESS_KEY)
      store.removeItem(REFRESH_KEY)
    }
  }

  return {
    role,
    profile,
    accessToken,
    refreshToken,
    isAuthenticated,
    isGuest,
    isMember,
    userLabel,
    applyToken,
    loginAsGuest,
    logout,
    clear,
  }
})
