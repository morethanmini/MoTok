/**
 * 세션 스토어 — 로그인 상태 / 게스트·회원 구분 / 프로필 / JWT 토큰.
 * 프로필 형태는 API 명세서 UserProfile 스키마를 그대로 따른다.
 *
 * 스토어 자체는 인메모리라 새로고침하면 비어 있다. 그래서 부팅·라우팅 시 restore()로
 * 저장된 토큰을 근거로 상태를 다시 세운다 — 이 복원이 없으면 새로고침 후 "로그인한 것 같지만
 * 프로필이 없는" 상태가 되어 화면이 기본값(P1)을 그리게 된다.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { TokenResponse, UserProfile } from '@/api/types'
import * as authApi from '@/api/auth'
import { usersApi } from '@/api/modules/users'
import { clearTokens, getAccessToken, readAnyAccessClaims, setAccessToken } from '@/api/token'
import { restoreSessionFromCookie } from '@/api/http'
import { rescheduleTokenAutoRefresh } from '@/api/refreshScheduler'

export type Role = 'guest' | 'member'

/**
 * 게스트 세션(임시 닉네임·1인방)은 sessionStorage에 둔다 (-109).
 * 새로고침·화면 이동에는 살아남고, 창(탭)을 닫으면 브라우저가 알아서 지운다 = "세션 종료 시 소멸".
 * 게스트 액세스 토큰도 같은 저장소를 쓰므로(token.ts) 둘의 수명이 어긋나지 않는다.
 */
const GUEST_KEY = 'motok.guest'

interface GuestSession {
  nickname: string | null
  roomId: string | null
}

function saveGuestSession(session: GuestSession) {
  sessionStorage.setItem(GUEST_KEY, JSON.stringify(session))
}

function loadGuestSession(): GuestSession | null {
  const raw = sessionStorage.getItem(GUEST_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as GuestSession
  } catch {
    return null
  }
}

export const useSessionStore = defineStore('session', () => {
  const role = ref<Role | null>(null)
  const profile = ref<UserProfile | null>(null)
  const accessToken = ref<string | null>(null)
  /** 게스트 시작 응답(GuestResponse)의 서버 부여 닉네임·1인방 ID — 게임 진입 시 사용 */
  const guestNickname = ref<string | null>(null)
  const guestRoomId = ref<string | null>(null)

  const isAuthenticated = computed(() => role.value !== null)
  const isGuest = computed(() => role.value === 'guest')
  const isMember = computed(() => role.value === 'member')
  /** 소셜 최초 로그인 직후 — 닉네임을 직접 정하기 전까지 다른 화면으로 못 가게 막는다(-22) */
  const nicknamePending = computed(() => isMember.value && profile.value?.nicknamePending === true)

  /** 로비 헤더 등에 노출되는 사용자 라벨 — 게스트는 서버가 부여한 임시 닉네임을 우선 표시 */
  const userLabel = computed(() =>
    isGuest.value
      ? `GUEST · ${guestNickname.value ?? '1인 전용'}`
      : `MEMBER · ${profile.value?.nickname ?? ''}`,
  )

  /**
   * 로그인 성공 응답을 세션에 반영한다.
   * Refresh 토큰은 응답 본문에 없다 — 서버가 HttpOnly 쿠키로 심어 두며, 재방문 시 자동 로그인
   * 여부(rememberMe)도 그 쿠키의 수명으로 서버가 정한다. 여기서 저장할 것은 액세스 토큰뿐이다.
   */
  function applyToken(res: TokenResponse) {
    role.value = 'member'
    profile.value = res.user ?? null
    accessToken.value = res.accessToken
    guestNickname.value = null
    guestRoomId.value = null
    sessionStorage.removeItem(GUEST_KEY)

    // 토큰은 token.ts가 단일 관리(http.ts의 자동 인증 헤더도 여기서 갱신됨).
    setAccessToken(res.accessToken)
    restored.value = true
    rescheduleTokenAutoRefresh()
  }

  function loginAsGuest(nickname?: string, roomId?: string) {
    role.value = 'guest'
    profile.value = null
    guestNickname.value = nickname ?? null
    guestRoomId.value = roomId ?? null
    saveGuestSession({ nickname: guestNickname.value, roomId: guestRoomId.value })
    restored.value = true
    rescheduleTokenAutoRefresh()
  }

  // ── 새로고침 복원 ────────────────────────────────────────────────
  const restored = ref(false)
  let restoring: Promise<void> | null = null

  /**
   * 세션을 복원한다.
   *  - 게스트 토큰          → sessionStorage에 남은 임시 닉네임·1인방 복원
   *  - 회원 토큰(만료 포함) → GET /users/me. 만료됐다면 http.ts가 알아서 갱신한다.
   *  - 토큰 없음            → 새로고침이라 메모리가 비었을 뿐일 수 있다. Refresh 쿠키로 한 번
   *                           되살려 보고, 그래도 안 되면 비로그인.
   */
  async function restore(): Promise<void> {
    const claims = readAnyAccessClaims()
    if (claims?.type === 'guest') {
      const guest = loadGuestSession()
      role.value = 'guest'
      profile.value = null
      guestNickname.value = guest?.nickname ?? null
      guestRoomId.value = guest?.roomId ?? null
      return
    }
    // 회원 액세스 토큰은 메모리에만 살아 있다 — 새로고침 직후엔 쿠키가 유일한 단서다.
    if (!claims && !(await restoreSessionFromCookie())) {
      clearLocal()
      return
    }
    try {
      profile.value = await usersApi.getMe()
      role.value = 'member'
      rescheduleTokenAutoRefresh()
    } catch {
      // 401(갱신 실패)이든 서버 장애든, 신원을 확인하지 못한 채 회원 화면을 열어 줄 수는 없다.
      clearLocal()
    }
  }

  /**
   * 잔액이 늘어난 것을 즉시 화면에 반영한다(게임 보상·포인트 충전).
   *
   * <p>서버가 진실이지만 게임 보상 지급은 비동기라, 방송받은 액수를 먼저 얹어 두고
   * {@link refreshProfile}이 나중에 정정한다. 안 하면 게임을 이겨도 잔액이 그대로라
   * "보상을 못 받았다"로 보인다.</p>
   */
  function addPoints(delta: number) {
    if (profile.value) profile.value.pointBalance += delta
  }

  /** 서버 기준으로 프로필을 다시 읽는다. 실패는 삼킨다 — 잔액 표시가 앱을 막을 이유는 없다. */
  async function refreshProfile() {
    if (!isMember.value) return
    try {
      profile.value = await usersApi.getMe()
    } catch {
      /* 다음 기회에 맞춰진다 */
    }
  }

  /** 라우터 가드·화면에서 부담 없이 부를 수 있는 단일 비행 복원. */
  function ensureRestored(): Promise<void> {
    if (restored.value) return Promise.resolve()
    if (!restoring) {
      restoring = restore().finally(() => {
        restored.value = true
        restoring = null
      })
    }
    return restoring
  }

  /**
   * 로그아웃 — 서버를 반드시 거쳐야 한다. Refresh 쿠키는 HttpOnly라 클라이언트가 지울 수 없고,
   * 서버측 Redis 세션도 함께 끊어야 14일간 남지 않는다.
   * 토큰은 스토어 ref가 아니라 token.ts에서 읽는다 — 새로고침 복원이나 자동 갱신으로 토큰이 바뀌어도
   * 항상 지금 유효한 값으로 무효화 요청을 보내기 위해서다.
   */
  async function logout() {
    const token = getAccessToken()
    if (token) {
      try {
        await authApi.logout(token)
      } catch {
        // 서버 무효화에 실패해도 로컬 세션은 반드시 정리한다.
      }
    }
    clear()
  }

  /** 스토어 상태만 비운다(토큰 저장소 포함). 복원 완료 표시는 유지 — 다시 조회하러 가지 않게. */
  function clearLocal() {
    role.value = null
    profile.value = null
    accessToken.value = null
    guestNickname.value = null
    guestRoomId.value = null
    sessionStorage.removeItem(GUEST_KEY)
    clearTokens()
  }

  function clear() {
    clearLocal()
    restored.value = true
    rescheduleTokenAutoRefresh()
  }

  return {
    role,
    profile,
    accessToken,
    guestNickname,
    guestRoomId,
    isAuthenticated,
    isGuest,
    isMember,
    nicknamePending,
    userLabel,
    restored,
    applyToken,
    loginAsGuest,
    ensureRestored,
    addPoints,
    refreshProfile,
    logout,
    clear,
  }
})
