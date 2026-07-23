/**
 * JWT 토큰 저장소 (localStorage/sessionStorage + 메모리 캐시).
 * 앱 전체의 토큰 단일 소스 — 세션 스토어(session.ts)와 HTTP 클라이언트(http.ts)가 모두 이 파일을 통해 토큰을 읽고 쓴다.
 * 로그인 성공 시 setTokens(), 로그아웃 시 clearTokens()를 호출하세요.
 *
 * persist=true  → localStorage (재방문 시 자동 로그인)
 * persist=false → sessionStorage (탭 종료 시 소멸, rememberMe 해제 로그인)
 */
const ACCESS_KEY = 'motok.accessToken'
const REFRESH_KEY = 'motok.refreshToken'

// import 시점 복원: 영구(localStorage) 우선, 없으면 탭 세션(sessionStorage).
let accessToken: string | null =
  localStorage.getItem(ACCESS_KEY) ?? sessionStorage.getItem(ACCESS_KEY)
let refreshToken: string | null =
  localStorage.getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY)

export function getAccessToken(): string | null {
  return accessToken
}

export function getRefreshToken(): string | null {
  return refreshToken
}

export function setTokens(access: string, refresh?: string, persist = true) {
  accessToken = access
  if (refresh) refreshToken = refresh

  const store = persist ? localStorage : sessionStorage
  const other = persist ? sessionStorage : localStorage
  store.setItem(ACCESS_KEY, access)
  if (refresh) store.setItem(REFRESH_KEY, refresh)
  // rememberMe 토글로 저장소가 바뀔 때 반대편 잔재를 남기지 않는다.
  other.removeItem(ACCESS_KEY)
  other.removeItem(REFRESH_KEY)
}

/** 액세스 토큰(JWT) 페이로드 — 백엔드 JwtTokenProvider가 싣는 클레임. */
export interface AccessClaims {
  /** 회원 PK 또는 guest-xxxx */
  sub: string
  type: 'member' | 'guest'
  /** 만료 시각(초) */
  exp: number
}

/**
 * 저장된 액세스 토큰의 클레임을 읽는다. 토큰이 없거나 형식이 깨졌거나 이미 만료됐으면 null.
 * 서명 검증은 서버 몫이고, 여기서는 화면 접근 제어(회원 전용 라우트) 판단에만 쓴다.
 */
export function readAccessClaims(): AccessClaims | null {
  const payload = accessToken?.split('.')[1]
  if (!payload) return null
  try {
    // JWT는 base64url — atob이 읽을 수 있게 문자 치환 + 패딩 복원
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as AccessClaims
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null
    return claims
  } catch {
    return null
  }
}

export function clearTokens() {
  accessToken = null
  refreshToken = null
  for (const store of [localStorage, sessionStorage]) {
    store.removeItem(ACCESS_KEY)
    store.removeItem(REFRESH_KEY)
  }
}
