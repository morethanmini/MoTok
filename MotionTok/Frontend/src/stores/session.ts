/**
 * 세션 스토어 — 로그인 상태 / 게스트·회원 구분 / 프로필.
 * 프로토타입에서 URL 쿼리(?role=guest)로 넘기던 값을 앱 전역 상태로 승격.
 * 실제 인증 연동(토큰 저장 등)은 login/loginAsGuest 내부 TODO 지점에 붙이면 됩니다.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type Role = 'guest' | 'member'

export interface Profile {
  nickname: string
  email: string
  coins: number
}

export const useSessionStore = defineStore('session', () => {
  const role = ref<Role | null>(null)
  const profile = ref<Profile | null>(null)

  const isAuthenticated = computed(() => role.value !== null)
  const isGuest = computed(() => role.value === 'guest')
  const isMember = computed(() => role.value === 'member')

  /** 로비 헤더 등에 노출되는 사용자 라벨 */
  const userLabel = computed(() =>
    isGuest.value ? 'GUEST · 1인 전용' : `MEMBER · ${profile.value?.nickname ?? 'P1'}`,
  )

  function login(payload: { email: string; nickname?: string }) {
    // TODO: 실제 로그인 API 연동 (토큰 발급/저장)
    role.value = 'member'
    profile.value = {
      email: payload.email,
      nickname: payload.nickname ?? 'P1',
      coins: 1250,
    }
  }

  function loginAsGuest() {
    role.value = 'guest'
    profile.value = { email: '', nickname: 'GUEST', coins: 0 }
  }

  function logout() {
    role.value = null
    profile.value = null
  }

  return {
    role,
    profile,
    isAuthenticated,
    isGuest,
    isMember,
    userLabel,
    login,
    loginAsGuest,
    logout,
  }
})
