/**
 * 핵심 HTTP 클라이언트 (fetch 래퍼, 외부 의존성 없음).
 * - 베이스 URL 자동 결합, JSON 직렬화/역직렬화
 * - 액세스 토큰 Bearer 자동 주입
 * - 액세스 토큰 만료 대응: 만료 임박 시 선제 갱신 + 401 시 1회 재발급 후 재시도
 * - 비 2xx 응답을 ApiError로 정규화 (명세의 Error 스키마)
 *
 * 각 도메인 모듈(api/modules/*)은 이 파일의 http.get/post/... 만 사용합니다.
 */
import { emitAccountBlocked, emitSessionExpired, type AccountBlockKind } from './authEvents'
import {
  accessTokenRemainingMs,
  clearTokens,
  getAccessToken,
  hasRefreshSession,
  readAnyAccessClaims,
  setAccessToken,
} from './token'
import type { ApiError as ApiErrorBody, TokenResponse } from './types'

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'

// 백엔드 경로 규약 (2026-07 기준, 백엔드가 아직 비일관):
//  - /auth·/users → base(/api) 바로 아래. 성공 응답은 raw DTO(래핑 없음).
//  - /v1/live-rooms·SF(video-token) → base + '/v1/...'. 성공 응답은 ApiResponse 래핑({success,message,data}).
//    → 래핑 리소스는 아래 httpEnvelope 클라이언트로 호출해 data만 받는다(전역 언래핑 금지: auth/users가 깨짐).
//  - 에러 응답은 전 리소스 공통으로 ErrorResponse({code,message,path,timestamp}) — 아래 request()가 ApiError로 정규화.

/** 명세 공통 오류 응답(Error)을 감싼 예외 */
export class ApiError extends Error {
  status: number
  code: string
  path?: string
  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message ?? `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code ?? 'UNKNOWN'
    this.path = body.path
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

function buildUrl(path: string, query?: Query): string {
  const url = new URL(API_BASE + path, window.location.origin)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

// ── 액세스 토큰 갱신 ────────────────────────────────────────────────
// 한 세션(로비 → 방 → 게임)이 30분을 훌쩍 넘기는 서비스라, 요청이 없는 동안에도 토큰이 만료된다.
// 그래서 "요청 직전 만료 임박이면 미리 갱신"과 "그래도 401이면 한 번 갱신 후 재시도"를 둘 다 건다.
// 갱신은 항상 단일 비행(single-flight) — 여러 요청이 동시에 401이 나도 refresh는 한 번만 돈다.
//
// 갱신에 쓰는 Refresh 토큰은 코드가 들고 있지 않다. HttpOnly 쿠키라 브라우저가 알아서 붙여 주고,
// 회전된 새 토큰도 응답의 Set-Cookie로 조용히 교체된다. 그래서 이 파일에는 토큰 값이 등장하지 않는다.
// (탭을 여러 개 열어 두면 갱신이 겹칠 수 있는데, 서버가 회전 직후 짧은 유예를 둬서 서로를 죽이지 않는다)

/** 남은 시간이 이보다 적으면 요청 전에 미리 갱신한다. */
const REFRESH_SKEW_MS = 5 * 60 * 1000

/**
 * 백엔드 ErrorCode의 제재 코드 → 안내에 쓸 종류.
 * 탈퇴·비활성(AUTH_ACCOUNT_NOT_ACTIVE)은 여기 없다 — 그건 로그인 경로에서만 나오고 문구가 다르다.
 */
const BLOCK_CODES: Record<string, AccountBlockKind> = {
  AUTH_ACCOUNT_SUSPENDED: 'SUSPENDED',
  AUTH_ACCOUNT_BANNED: 'BANNED',
}

let refreshInFlight: Promise<boolean> | null = null

/** 인증 도메인 경로 — 토큰 없이도 부르고, refresh 자신이라 재귀·순환을 막아야 한다. */
function isAuthPath(path: string): boolean {
  return path.startsWith('/auth/')
}

/** 갱신을 시도해 볼 만한가 — 게스트는 Refresh 쿠키가 없고, 비로그인 방문자를 헛되이 두드리지 않는다. */
function canRefresh(): boolean {
  return hasRefreshSession()
}

async function runRefresh(silent = false): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh(silent).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function doRefresh(silent: boolean): Promise<boolean> {
  let res: Response
  try {
    res = await fetch(buildUrl('/auth/token/refresh'), {
      method: 'POST',
      // 다른 오리진의 백엔드를 보는 개발 설정에서도 쿠키가 실리도록 명시한다(같은 오리진이면 기본값과 동일).
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    // 서버가 거절한 게 아니라 요청이 나가지도 못했다(끊긴 와이파이·서버 재시작 중).
    // 여기서 세션을 버리면 지하철에서 잠깐 끊긴 것만으로 게임 도중 로그아웃된다.
    // 쿠키는 그대로 살아 있으니 다음 시도(스케줄러 30초 뒤 재시도)에 맡긴다.
    return false
  }

  if (!res.ok) {
    // 서버가 명시적으로 거절했다 — 쿠키가 없거나 만료됐거나 재사용으로 무효화된 경우다. 되살릴 방법이 없다.
    const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null
    clearTokens()
    // 다른 곳 로그인으로 밀려난 세션(단일 세션) — silent(새로고침 복원)라도 안내한다.
    // 이 코드는 세션이 실재했다는 증거라, 로그인한 적 없는 방문자의 조용한 실패와는 다르다.
    if (body?.code === 'AUTH_SESSION_DISPLACED') emitSessionExpired('displaced')
    else if (!silent) emitSessionExpired()
    return false
  }

  try {
    const body = (await res.json()) as TokenResponse
    setAccessToken(body.accessToken)
    return true
  } catch {
    // 200인데 본문이 깨졌다 — 세션이 죽었다는 근거는 아니므로 유지하고 다시 시도한다.
    return false
  }
}

/**
 * 새로고침 복원 — 회원 액세스 토큰은 메모리에만 있어 새로고침하면 사라진다.
 * Refresh 쿠키가 살아 있으면 여기서 세션이 되살아나고, 없으면 그냥 비로그인이다.
 * 로그인한 적 없는 방문자도 이 경로로 들어오므로 실패해도 "세션 만료" 안내를 내지 않는다.
 */
export async function restoreSessionFromCookie(): Promise<boolean> {
  if (readAnyAccessClaims()?.type === 'guest') return false
  return runRefresh(true)
}

/** 액세스 토큰이 곧 만료되고 갱신 수단이 있으면 미리 갱신한다(게스트는 갱신 수단이 없어 그냥 지나간다). */
async function ensureFreshAccessToken(): Promise<void> {
  if (!getAccessToken() || !canRefresh()) return
  if (accessTokenRemainingMs() > REFRESH_SKEW_MS) return
  await runRefresh()
}

/** 화면 복귀·타이머 등 요청 밖에서도 갱신을 돌릴 수 있게 열어 둔다(refreshScheduler.ts). */
export async function refreshAccessTokenIfNeeded(): Promise<void> {
  await ensureFreshAccessToken()
}

/**
 * 만료와 무관하게 액세스 토큰을 즉시 회전시킨다(게스트는 갱신 수단이 없어 그냥 지나간다).
 * 서버는 방 참가자·채팅 표시명을 액세스 토큰의 name 클레임에서 읽으므로,
 * 닉네임처럼 클레임에 박히는 값이 바뀌면 변경 직후 새 토큰을 받아야 한다.
 */
export async function forceRefreshAccessToken(): Promise<void> {
  if (!canRefresh()) return
  await runRefresh()
}

async function request<T>(
  method: string,
  path: string,
  opts: { query?: Query; body?: unknown } = {},
  allowRetry = true,
): Promise<T> {
  if (!isAuthPath(path)) await ensureFreshAccessToken()

  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let bodyInit: BodyInit | undefined
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    bodyInit = JSON.stringify(opts.body)
  }

  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body: bodyInit,
    credentials: 'include',
  })

  // 선제 갱신이 빗나갔거나(시계 오차) 서버가 토큰을 무효화한 경우 — 한 번만 갱신 후 재시도한다.
  if (res.status === 401 && allowRetry && !isAuthPath(path) && canRefresh()) {
    if (await runRefresh()) return request<T>(method, path, opts, false)
  }

  if (res.status === 204) return undefined as T

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    const error = new ApiError(res.status, (payload ?? {}) as Partial<ApiErrorBody>)
    // 계정 제재는 재시도로 풀리지 않는다 — 토큰은 멀쩡하고 계정이 막힌 것이라 갱신도 무의미하다.
    // 화면마다 403을 따로 해석하게 두면 어떤 화면은 조용히 빈 목록을 보여 주므로 여기서 한 번에 알린다.
    const blockKind = error.status === 403 ? BLOCK_CODES[error.code] : undefined
    if (blockKind) {
      emitAccountBlocked(blockKind)
    }
    throw error
  }
  return payload as T
}

export const http = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, { body, query }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  // 탈퇴처럼 본인 확인 값을 실어 보내는 DELETE가 있어 본문을 허용한다(명세 DELETE /users/me).
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, { body }),
}

/**
 * 백엔드 표준 래핑 응답 { success, message, data }.
 * ⚠️ 전역 규약이 아님 — /v1/live-rooms 와 SFU(video-token)만 이 형식이고 auth·users는 raw DTO.
 */
export interface ApiEnvelope<T> {
  success: boolean
  message: string
  data: T
}

/**
 * 래핑 응답(ApiEnvelope)을 반환하는 리소스 전용 클라이언트. `http`와 동일한 메서드 표면을 가지되
 * 성공 시 `data`만 꺼내 반환한다. (에러는 request()가 이미 ApiError로 throw하므로 여기 도달 안 함.)
 * 사용처: api/modules/rooms.ts, (예정) SFU video-token 모듈.
 */
export const httpEnvelope = {
  get: <T>(path: string, query?: Query) =>
    request<ApiEnvelope<T>>('GET', path, { query }).then((r) => r.data),
  post: <T>(path: string, body?: unknown, query?: Query) =>
    request<ApiEnvelope<T>>('POST', path, { body, query }).then((r) => r.data),
  put: <T>(path: string, body?: unknown) =>
    request<ApiEnvelope<T>>('PUT', path, { body }).then((r) => r.data),
  patch: <T>(path: string, body?: unknown) =>
    request<ApiEnvelope<T>>('PATCH', path, { body }).then((r) => r.data),
  // 정지 해제처럼 사유를 실어 보내는 DELETE가 있어 본문을 허용한다(http.delete와 동일).
  delete: <T>(path: string, body?: unknown) =>
    request<ApiEnvelope<T>>('DELETE', path, { body }).then((r) => r.data),
}
