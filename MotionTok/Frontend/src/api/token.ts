/**
 * JWT 토큰 저장소 (localStorage + 메모리 캐시).
 * 기존 session 스토어를 건드리지 않기 위해 API 레이어가 토큰을 독립적으로 관리합니다.
 * 로그인 성공 시 setTokens(), 로그아웃 시 clearTokens()를 호출하세요.
 */
const ACCESS_KEY = 'motok.accessToken'
const REFRESH_KEY = 'motok.refreshToken'

let accessToken: string | null = localStorage.getItem(ACCESS_KEY)
let refreshToken: string | null = localStorage.getItem(REFRESH_KEY)

export function getAccessToken(): string | null {
  return accessToken
}

export function getRefreshToken(): string | null {
  return refreshToken
}

export function setTokens(access: string, refresh?: string) {
  accessToken = access
  localStorage.setItem(ACCESS_KEY, access)
  if (refresh) {
    refreshToken = refresh
    localStorage.setItem(REFRESH_KEY, refresh)
  }
}

export function clearTokens() {
  accessToken = null
  refreshToken = null
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}
