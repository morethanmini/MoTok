/**
 * 핵심 HTTP 클라이언트 (fetch 래퍼, 외부 의존성 없음).
 * - 베이스 URL 자동 결합, JSON 직렬화/역직렬화
 * - 액세스 토큰 Bearer 자동 주입
 * - 비 2xx 응답을 ApiError로 정규화 (명세의 Error 스키마)
 *
 * 각 도메인 모듈(api/modules/*)은 이 파일의 http.get/post/... 만 사용합니다.
 */
import { getAccessToken } from './token'
import type { ApiError as ApiErrorBody } from './types'

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

async function request<T>(
  method: string,
  path: string,
  opts: { query?: Query; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let bodyInit: BodyInit | undefined
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    bodyInit = JSON.stringify(opts.body)
  }

  const res = await fetch(buildUrl(path, opts.query), { method, headers, body: bodyInit })

  if (res.status === 204) return undefined as T

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    throw new ApiError(res.status, (payload ?? {}) as Partial<ApiErrorBody>)
  }
  return payload as T
}

export const http = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, { body, query }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
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
  delete: <T>(path: string) => request<ApiEnvelope<T>>('DELETE', path).then((r) => r.data),
}
