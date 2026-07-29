/**
 * JWT 액세스 토큰 저장소 (메모리 + 게스트 한정 sessionStorage).
 * 앱 전체의 토큰 단일 소스 — 세션 스토어(session.ts)와 HTTP 클라이언트(http.ts)가 여기를 통해 읽고 쓴다.
 *
 * ## 회원 토큰은 메모리에만 둔다
 * localStorage·sessionStorage는 같은 출처의 스크립트가 전부 읽을 수 있다. XSS가 한 번 터지면
 * 거기 있던 토큰은 그대로 넘어간다. 새로고침 복원은 저장이 아니라 <b>HttpOnly Refresh 쿠키</b>로 한다 —
 * 부팅 때 한 번 갱신을 돌리면 세션이 되살아나므로(session.restore) 액세스 토큰을 남길 이유가 없다.
 *
 * Refresh 토큰은 이 파일에 아예 오지 않는다. 브라우저가 쿠키로만 들고 있고 스크립트는 값을 볼 수 없다.
 *
 * ## 게스트 토큰만 예외로 sessionStorage에 남긴다
 * 게스트에겐 Refresh 쿠키가 없어(서버측 세션 자체가 없다) 메모리에만 두면 새로고침 한 번에
 * 세션과 1인방을 잃는다. 게스트 토큰은 회원 전용 API(/users·친구·상점·신고·업로드)가 전부 막혀 있어
 * 탈취해도 얻을 게 없다 — 그래서 여기만 편의를 택했다. 탭을 닫으면 브라우저가 알아서 지운다.
 */
const GUEST_KEY = 'motok.guest.accessToken'

/** 토큰을 스토리지에 두던 시절의 키. 남겨 두면 14일짜리 Refresh 토큰이 브라우저에 계속 떠 있게 된다. */
const LEGACY_KEYS = ['motok.accessToken', 'motok.refreshToken']

let accessToken: string | null = null

/**
 * Refresh 쿠키로 갱신할 수 있는 세션인가.
 * 쿠키가 HttpOnly라 존재 여부를 직접 볼 수 없어, "회원으로 토큰을 받은 적 있다"는 사실로 대신한다.
 * 게스트·비로그인은 false — 갱신을 시도해 봐야 401이고, 로그인한 적 없는 방문자에게
 * "세션이 만료되었어요"를 띄우게 된다.
 */
let refreshable = false

/** 액세스 토큰(JWT) 페이로드 — 백엔드 JwtTokenProvider가 싣는 클레임. */
export interface AccessClaims {
  /** 회원 PK 또는 guest-xxxx */
  sub: string
  type: 'member' | 'guest'
  /** users.role — v0.2.17(-133)부터 회원 토큰에 실림. 구 토큰·게스트는 없음(undefined) */
  role?: 'USER' | 'ADMIN'
  /** 발급 시각(초) */
  iat?: number
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

if (typeof window !== 'undefined') {
  for (const key of LEGACY_KEYS) {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  }
  const guest = sessionStorage.getItem(GUEST_KEY)
  // 만료된 게스트 토큰을 들고 복원하면 화면만 살아 있고 모든 요청이 401이 된다 — 아예 비로그인으로 시작한다.
  const claims = decodeClaims(guest)
  if (claims && claims.exp * 1000 > Date.now()) {
    accessToken = guest
  } else {
    sessionStorage.removeItem(GUEST_KEY)
  }
}

export function getAccessToken(): string | null {
  return accessToken
}

/** 회원 액세스 토큰 — 로그인·소셜 로그인·갱신 응답에서 받은 값. 저장하지 않는다. */
export function setAccessToken(token: string) {
  accessToken = token
  refreshable = true
  sessionStorage.removeItem(GUEST_KEY)
}

/** 게스트 액세스 토큰 — 새로고침에도 살아남아야 해서 탭 세션에 남긴다. */
export function setGuestAccessToken(token: string) {
  accessToken = token
  refreshable = false
  sessionStorage.setItem(GUEST_KEY, token)
}

/** 갱신을 시도해 볼 만한 세션인지 — http.ts·refreshScheduler.ts가 헛된 요청을 막는 데 쓴다. */
export function hasRefreshSession(): boolean {
  return refreshable
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
 * 만료됐어도 클레임을 읽는다 — "만료된 세션"과 "애초에 토큰이 없음"을 구분해야 하는 곳에서 쓴다.
 * (부팅 시 복원: 토큰이 아예 없으면 Refresh 쿠키로 되살리고, 게스트면 갱신 자체를 건너뛴다)
 */
export function readAnyAccessClaims(): AccessClaims | null {
  return decodeClaims(accessToken)
}

/**
 * 게스트 세션의 총 이용 시간(분) — 만료 안내 문구("게스트 시간(30분)이 만료되었어요")에 쓴다.
 * 토큰에서 계산하므로 서버 설정(jwt.guest-expiration-ms)이 바뀌면 문구도 따라간다.
 * 게스트가 아니거나 iat이 없는 토큰이면 null.
 */
export function guestSessionMinutes(): number | null {
  const claims = decodeClaims(accessToken)
  if (claims?.type !== 'guest' || typeof claims.iat !== 'number') return null
  return Math.round((claims.exp - claims.iat) / 60)
}

/** 액세스 토큰이 만료되기까지 남은 시간(ms). 토큰이 없거나 이미 만료면 0. */
export function accessTokenRemainingMs(): number {
  const claims = decodeClaims(accessToken)
  if (!claims) return 0
  return Math.max(0, claims.exp * 1000 - Date.now())
}

/**
 * 로컬 흔적을 지운다. Refresh 쿠키는 서버만 지울 수 있으므로(HttpOnly)
 * 로그아웃은 반드시 POST /auth/logout을 거쳐야 한다 — 여기서 지우는 건 이 탭의 상태뿐이다.
 */
export function clearTokens() {
  accessToken = null
  refreshable = false
  sessionStorage.removeItem(GUEST_KEY)
}
