/**
 * 파일 업로드 API (명세 확장).
 *
 * 업로드는 서버를 거치지 않는다 — 서버에서 presigned URL을 받아 브라우저가 S3로 직접 PUT한다.
 * 서버 대역폭·메모리를 쓰지 않고 대용량(음원)에도 견딘다.
 *
 * 직접 쓰기보다 `useUpload` 컴포저블을 쓰는 편이 낫다. 3단계(presign → PUT → 확정)를 묶어 준다.
 */
import { http } from '../http'
import type { PresignUploadRequest, PresignUploadResponse, UploadPurpose } from '../types'

export const uploadsApi = {
  /**
   * 업로드용 presigned URL 발급.
   * key·파일명은 보내지 않는다 — 서버가 인증된 userId로 조립한다(남의 경로에 쓰는 것을 막기 위해).
   */
  presign: (body: PresignUploadRequest) =>
    http.post<PresignUploadResponse>('/uploads/presign', body),
}

/**
 * presigned URL로 실제 파일을 올린다.
 *
 * `fetch`를 쓰는 이유 — 이 요청은 우리 API가 아니라 S3로 직접 나가므로
 * Authorization 헤더를 붙이면 안 된다(서명과 충돌한다). `http` 클라이언트는 토큰을 자동으로
 * 붙이므로 여기서는 쓸 수 없다.
 */
export async function putToPresignedUrl(
  presigned: PresignUploadResponse,
  file: Blob,
): Promise<void> {
  const res = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: presigned.requiredHeaders,
    body: file,
  })
  if (!res.ok) {
    // 403은 대부분 서명 불일치(파일 크기·타입이 presign 요청과 다름)이거나 URL 만료다.
    throw new UploadError(res.status, await safeText(res))
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

/** S3 직접 업로드 실패. 우리 API의 ApiError와 구분하려고 별도 타입을 둔다. */
export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`업로드 실패 (${status})`)
    this.name = 'UploadError'
  }
}

/** 용도별 클라이언트 측 사전 검사 값. 서버 UploadPurpose와 같은 정책을 미리 알려 주기 위한 것. */
export const UPLOAD_LIMITS: Record<UploadPurpose, { maxBytes: number; accept: string[] }> = {
  AVATAR: { maxBytes: 2 * 1024 * 1024, accept: ['image/png', 'image/jpeg', 'image/webp'] },
  AI_ITEM: { maxBytes: 2 * 1024 * 1024, accept: ['image/png', 'image/webp'] },
  SONG: { maxBytes: 20 * 1024 * 1024, accept: ['audio/mpeg', 'audio/mp4', 'audio/ogg'] },
}
