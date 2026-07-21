/**
 * 인증 도메인용 REST 클라이언트 (명시적 토큰 주입 방식).
 * 오류 응답은 API 명세서 Error 스키마({ code, message, path, timestamp })이며,
 * 앱 전체에서 단일한 ApiError(= http.ts)로 정규화해 호출부가 code로 분기할 수 있게 한다.
 */
import { API_BASE, ApiError } from './http'
import type { ApiError as ApiErrorBody } from './types'

// 단일 ApiError를 이 경로에서도 그대로 노출한다(`import { ApiError } from '@/api/client'` 유지).
export { ApiError }

/** 네트워크 자체가 실패한 경우(서버 미기동 등) */
export class NetworkError extends Error {
  constructor() {
    super('서버에 연결할 수 없습니다.')
    this.name = 'NetworkError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Authorization 헤더에 실을 액세스 토큰 */
  token?: string | null
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new NetworkError()
  }

  if (!res.ok) {
    let errorBody: ApiErrorBody = { code: 'UNKNOWN', message: '알 수 없는 오류가 발생했습니다.' }
    try {
      errorBody = (await res.json()) as ApiErrorBody
    } catch {
      // 오류 본문이 JSON이 아닌 경우 기본 메시지를 유지한다.
    }
    throw new ApiError(res.status, errorBody)
  }

  // 204 No Content / 202 Accepted 처럼 본문이 없는 응답
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
