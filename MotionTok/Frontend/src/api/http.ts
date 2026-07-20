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

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080/api'

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
