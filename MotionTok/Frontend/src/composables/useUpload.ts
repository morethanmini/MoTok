/**
 * 파일 업로드 — presign → S3 직접 PUT → 서버에 확정, 세 단계를 하나로 묶는다.
 *
 * 왜 세 단계인가 — 업로드가 서버를 거치지 않기 때문이다. 서버는 "올려도 된다"는 서명만 주고(1),
 * 실제 전송은 브라우저와 S3 사이에서 일어나며(2), 서버는 끝난 뒤 결과 key만 전달받아
 * 소유권과 존재를 확인한다(3). 3단계를 빼면 올라간 파일이 어디에도 기록되지 않는다.
 *
 * 사용 예)
 *   const { upload, uploading, error } = useUpload('AVATAR')
 *   const key = await upload(file)          // null이면 실패(error에 사유)
 *   if (key) await usersApi.updateAvatar(key)
 */
import { ref } from 'vue'
import {
  ApiError,
  UPLOAD_LIMITS,
  UploadError,
  putToPresignedUrl,
  uploadsApi,
  type PresignUploadResponse,
  type UploadPurpose,
} from '@/api'

/** 서버 ErrorCode → 사용자에게 보여줄 문구. 코드가 없으면 일반 메시지로 떨어진다. */
const MESSAGES: Record<string, string> = {
  UPLOAD_UNSUPPORTED_TYPE: '지원하지 않는 파일 형식이에요',
  UPLOAD_TOO_LARGE: '파일이 너무 커요',
  UPLOAD_KEY_FORBIDDEN: '이 파일에 대한 권한이 없어요',
  UPLOAD_OBJECT_NOT_FOUND: '업로드된 파일을 찾지 못했어요',
  UPLOAD_PURPOSE_NOT_PRESIGNABLE: '직접 올릴 수 없는 파일이에요',
  STORAGE_UNAVAILABLE: '파일 저장소에 연결할 수 없어요',
}

export function useUpload(purpose: UploadPurpose) {
  const uploading = ref(false)
  const error = ref<string | null>(null)
  /** 업로드 직후의 공개 URL. 서버 확정 전에 미리 보여주고 싶을 때 쓴다. */
  const lastPublicUrl = ref<string | null>(null)

  const limits = UPLOAD_LIMITS[purpose]

  /**
   * 서버에 요청하기 전에 먼저 거른다. 서버도 같은 검사를 하지만(그쪽이 진짜 방어선),
   * 왕복 한 번을 아끼고 "2MB 넘어요"를 즉시 알려줄 수 있다.
   */
  function validate(file: File): string | null {
    if (!limits.accept.includes(file.type)) {
      // MIME의 서브타입만 뽑아 "PNG, JPEG, WEBP" 형태로 안내한다.
      // 인덱스 접근(split('/')[1])은 noUncheckedIndexedAccess에서 undefined가 섞여 타입 에러가 나므로 replace를 쓴다.
      const kinds = limits.accept.map((t) => t.replace(/^[^/]+\//, '').toUpperCase()).join(', ')
      return `${kinds} 파일만 올릴 수 있어요`
    }
    if (file.size > limits.maxBytes) {
      return `${Math.floor(limits.maxBytes / 1024 / 1024)}MB 이하만 올릴 수 있어요`
    }
    if (file.size === 0) {
      return '빈 파일은 올릴 수 없어요'
    }
    return null
  }

  /**
   * 업로드 실행. 성공하면 오브젝트 key, 실패하면 null을 돌려주고 error에 사유를 담는다.
   * 예외를 던지지 않는 이유 — 호출부가 대부분 "실패하면 토스트만 띄우면 되는" 화면이라
   * try/catch를 강제하면 코드가 지저분해진다.
   */
  async function upload(file: File): Promise<string | null> {
    error.value = null

    const invalid = validate(file)
    if (invalid) {
      error.value = invalid
      return null
    }

    uploading.value = true
    try {
      // 1) 서명 받기. contentType·contentLength가 서명에 들어가므로 실제 파일과 정확히 같아야 한다.
      const presigned: PresignUploadResponse = await uploadsApi.presign({
        purpose,
        contentType: file.type,
        contentLength: file.size,
      })

      // 2) S3로 직접 PUT (우리 서버를 거치지 않는다)
      await putToPresignedUrl(presigned, file)

      lastPublicUrl.value = presigned.publicUrl
      return presigned.key
    } catch (e) {
      error.value = toMessage(e)
      return null
    } finally {
      uploading.value = false
    }
  }

  return { upload, uploading, error, lastPublicUrl, validate }
}

function toMessage(e: unknown): string {
  if (e instanceof ApiError) {
    return MESSAGES[e.code] ?? e.message
  }
  if (e instanceof UploadError) {
    // 403은 서명 불일치 또는 URL 만료다. 사용자가 할 수 있는 일은 재시도뿐이라 그렇게 안내한다.
    if (e.status === 403) {
      return '업로드 권한이 만료됐어요. 다시 시도해 주세요'
    }
    return '업로드에 실패했어요. 잠시 후 다시 시도해 주세요'
  }
  return '업로드에 실패했어요'
}
