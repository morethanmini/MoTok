/**
 * 세션 스토어 — 로그인 상태 / 게스트·회원 구분 / 프로필 / JWT 토큰.
 * 프로필 형태는 API 명세서 UserProfile 스키마를 그대로 따른다.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { TokenResponse, UserProfile } from '@/api/types'
import * as authApi from '@/api/auth'
import { setTokens, clearTokens } from '@/api/token'

export type Role = 'guest' | 'member'

export const useSessionStore = defineStore('session', () => {
  const role = ref<Role | null>(null)
  const profile = ref<UserProfile | null>(null)
  const accessToken = ref<string | null>(null)
  const refreshToken = ref<string | null>(null)
  /** 게스트 시작 응답(GuestResponse)의 서버 부여 닉네임·1인방 ID — 게임 진입 시 사용 */
  const guestNickname = ref<string | null>(null)
  const guestRoomId = ref<string | null>(null)

  const isAuthenticated = computed(() => role.value !== null)
  const isGuest = computed(() => role.value === 'guest')
  const isMember = computed(() => role.value === 'member')

  /** 로비 헤더 등에 노출되는 사용자 라벨 — 게스트는 서버가 부여한 임시 닉네임을 우선 표시 */
  const userLabel = computed(() =>
    isGuest.value
      ? `GUEST · ${guestNickname.value ?? '1인 전용'}`
      : `MEMBER · ${profile.value?.nickname ?? 'P1'}`,
  )

  /**
   * 로그인 성공 응답을 세션에 반영한다.
   * rememberMe면 localStorage(재방문 시 자동 로그인), 아니면 sessionStorage(탭 종료 시 소멸).
   */
  function applyToken(res: TokenResponse, rememberMe = false) {
    role.value = 'member'
    profile.value = res.user ?? null
    accessToken.value = res.accessToken
    refreshToken.value = res.refreshToken

    // 토큰 저장/복원은 token.ts가 단일 관리(http.ts의 자동 인증 헤더도 여기서 갱신됨).
    setTokens(res.accessToken, res.refreshToken, rememberMe)
  }

  function loginAsGuest(nickname?: string, roomId?: string) {
    role.value = 'guest'
    profile.value = null
    guestNickname.value = nickname ?? null
    guestRoomId.value = roomId ?? null
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
    guestNickname.value = null
    guestRoomId.value = null
    clearTokens()
  }

  return {
    role,
    profile,
    accessToken,
    refreshToken,
    guestNickname,
    guestRoomId,
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
