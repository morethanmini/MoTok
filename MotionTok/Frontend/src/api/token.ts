/**
 * JWT 토큰 저장소 (localStorage/sessionStorage + 메모리 캐시).
 * 앱 전체의 토큰 단일 소스 — 세션 스토어(session.ts)와 HTTP 클라이언트(http.ts)가 모두 이 파일을 통해 토큰을 읽고 쓴다.
 * 로그인 성공 시 setTokens(), 로그아웃 시 clearTokens()를 호출하세요.
 *
 * persist=true  → localStorage (재방문 시 자동 로그인)
 * persist=false → sessionStorage (탭 종료 시 소멸, rememberMe 해제 로그인 · 게스트)
 */
const ACCESS_KEY = 'motok.accessToken'
const REFRESH_KEY = 'motok.refreshToken'

// import 시점 복원: 영구(localStorage) 우선, 없으면 탭 세션(sessionStorage).
let accessToken: string | null =
  localStorage.getItem(ACCESS_KEY) ?? sessionStorage.getItem(ACCESS_KEY)
let refreshToken: string | null =
  localStorage.getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY)

/**
 * 다른 탭이 토큰을 회전시키면(refresh) 이 탭의 메모리 캐시는 옛 값을 들고 있게 된다.
 * Refresh 토큰은 서버에서 1개만 유효하므로, 옛 값을 계속 쓰면 이 탭만 세션이 끊긴다.
 * storage 이벤트는 '다른 탭'에서만 발생하므로 여기서 캐시만 맞춰 주면 된다(localStorage 저장 시에만 발생).
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === ACCESS_KEY) accessToken = e.newValue
    if (e.key === REFRESH_KEY) refreshToken = e.newValue
  })
}

export function getAccessToken(): string | null {
  return accessToken
}

export function getRefreshToken(): string | null {
  return refreshToken
}

/** 현재 세션이 localStorage(재방문 유지)인지 — 토큰 회전 시 같은 저장소를 유지하기 위해 쓴다. */
export function isPersistentSession(): boolean {
  return localStorage.getItem(ACCESS_KEY) !== null
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
  /** users.role — v0.2.16(-133)부터 회원 토큰에 실림. 구 토큰·게스트는 없음(undefined) */
  role?: 'USER' | 'ADMIN'
  /** 만료 시각(초) */
  exp: number
}

/** 서명 검증 없이 페이로드만 읽는다(만료 여부는 보지 않음). 서명 검증은 서버 몫. */
function decodeClaims(token: string | null): AccessClaims | null {
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    // JWT는 base64url — atob이 읽을 수 있게 문자 치환 + 패딩 복원
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as AccessClaims
    return typeof claims.exp === 'number' ? claims : null
  } catch {
    return null
  }
}

/**
 * 저장된 액세스 토큰의 클레임을 읽는다. 토큰이 없거나 형식이 깨졌거나 이미 만료됐으면 null.
 * 화면 접근 제어(회원 전용 라우트) 판단용이며, 실제 데이터 권한은 서버가 다시 검증한다.
 */
export function readAccessClaims(): AccessClaims | null {
  const claims = decodeClaims(accessToken)
  if (!claims || claims.exp * 1000 <= Date.now()) return null
  return claims
}

/**
 * 만료됐어도 클레임을 읽는다 — "만료된 회원 세션"과 "애초에 비로그인"을 구분해야 하는 곳에서 쓴다.
 * (부팅 시 복원: 만료된 회원 토큰이면 refresh를 시도하고, 아무것도 없으면 그냥 비로그인)
 */
export function readAnyAccessClaims(): AccessClaims | null {
  return decodeClaims(accessToken)
}

/** 액세스 토큰이 만료되기까지 남은 시간(ms). 토큰이 없거나 이미 만료면 0. */
export function accessTokenRemainingMs(): number {
  const claims = decodeClaims(accessToken)
  if (!claims) return 0
  return Math.max(0, claims.exp * 1000 - Date.now())
}

export function clearTokens() {
  accessToken = null
  refreshToken = null
  for (const store of [localStorage, sessionStorage]) {
    store.removeItem(ACCESS_KEY)
    store.removeItem(REFRESH_KEY)
  }
}
