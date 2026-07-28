/**
 * 업로드 컴포저블 규칙.
 *
 * 여기서 지키는 것은 두 가지다.
 * 1) 서버에 보내기 전에 명백히 안 될 파일을 걸러 왕복을 아끼는 것 (서버도 같은 검사를 하지만
 *    그쪽이 진짜 방어선이고, 이건 즉시 피드백을 위한 것이다)
 * 2) 실패를 예외로 터뜨리지 않고 error 문자열로 돌려주는 것 — 호출부가 대부분 토스트만 띄우는
 *    화면이라 try/catch 를 강제하면 코드가 지저분해진다
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const presign = vi.fn()
const putToPresignedUrl = vi.fn()

class FakeApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
class FakeUploadError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`업로드 실패 (${status})`)
  }
}

vi.mock('@/api', () => ({
  ApiError: FakeApiError,
  UploadError: FakeUploadError,
  uploadsApi: { presign: (...a: unknown[]) => presign(...a) },
  putToPresignedUrl: (...a: unknown[]) => putToPresignedUrl(...a),
  UPLOAD_LIMITS: {
    AVATAR: { maxBytes: 2 * 1024 * 1024, accept: ['image/png', 'image/jpeg', 'image/webp'] },
    AI_ITEM: { maxBytes: 2 * 1024 * 1024, accept: ['image/png', 'image/webp'] },
    SONG: { maxBytes: 20 * 1024 * 1024, accept: ['audio/mpeg', 'audio/mp4', 'audio/ogg'] },
  },
}))

const { useUpload } = await import('@/composables/useUpload')

function file(type: string, size: number, name = 'a.png'): File {
  const f = new File([''], name, { type })
  // File 생성자로는 크기를 못 정하므로 size 만 덮어쓴다
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const OK_PRESIGN = {
  uploadUrl: 'http://localhost:9000/motok-local/public/avatars/1/x.png?sig',
  key: 'public/avatars/1/x.png',
  publicUrl: 'http://localhost:9000/motok-local/public/avatars/1/x.png',
  expiresInSeconds: 180,
  requiredHeaders: { 'content-type': 'image/png', 'content-length': '1024' },
}

describe('useUpload', () => {
  beforeEach(() => {
    presign.mockReset()
    putToPresignedUrl.mockReset()
  })

  it('성공하면 key를 돌려주고, presign에 실제 파일의 타입·크기를 그대로 보낸다', async () => {
    presign.mockResolvedValue(OK_PRESIGN)
    putToPresignedUrl.mockResolvedValue(undefined)
    const { upload, error, uploading, lastPublicUrl } = useUpload('AVATAR')

    const key = await upload(file('image/png', 1024))

    expect(key).toBe('public/avatars/1/x.png')
    expect(error.value).toBeNull()
    expect(uploading.value).toBe(false)
    expect(lastPublicUrl.value).toBe(OK_PRESIGN.publicUrl)
    // 크기·타입이 서명에 들어가므로 실제 파일과 어긋나면 S3가 거부한다
    expect(presign).toHaveBeenCalledWith({
      purpose: 'AVATAR',
      contentType: 'image/png',
      contentLength: 1024,
    })
  })

  it('허용하지 않는 형식은 서버에 요청하지 않는다', async () => {
    const { upload, error } = useUpload('AVATAR')

    const key = await upload(file('image/gif', 1024, 'a.gif'))

    expect(key).toBeNull()
    expect(error.value).toContain('올릴 수 있어요')
    expect(presign).not.toHaveBeenCalled()
  })

  it('용량 초과는 서버에 요청하지 않고, 경계값은 통과시킨다', async () => {
    const { upload, error } = useUpload('AVATAR')

    expect(await upload(file('image/png', 2 * 1024 * 1024 + 1))).toBeNull()
    expect(error.value).toContain('2MB')
    expect(presign).not.toHaveBeenCalled()

    presign.mockResolvedValue(OK_PRESIGN)
    putToPresignedUrl.mockResolvedValue(undefined)
    expect(await upload(file('image/png', 2 * 1024 * 1024))).toBe('public/avatars/1/x.png')
  })

  it('빈 파일을 거부한다', async () => {
    const { upload, error } = useUpload('AVATAR')

    expect(await upload(file('image/png', 0))).toBeNull()
    expect(error.value).toContain('빈 파일')
  })

  it('서버 ErrorCode를 사용자 문구로 바꾼다', async () => {
    presign.mockRejectedValue(new FakeApiError(413, 'UPLOAD_TOO_LARGE', 'raw'))
    const { upload, error } = useUpload('AVATAR')

    expect(await upload(file('image/png', 1024))).toBeNull()
    expect(error.value).toBe('파일이 너무 커요')
  })

  it('S3 403은 만료·서명 문제라 재시도를 안내한다', async () => {
    presign.mockResolvedValue(OK_PRESIGN)
    putToPresignedUrl.mockRejectedValue(new FakeUploadError(403, 'SignatureDoesNotMatch'))
    const { upload, error } = useUpload('AVATAR')

    expect(await upload(file('image/png', 1024))).toBeNull()
    expect(error.value).toContain('다시 시도')
  })

  it('실패해도 예외를 던지지 않고 uploading을 되돌린다', async () => {
    presign.mockRejectedValue(new Error('network'))
    const { upload, uploading, error } = useUpload('AVATAR')

    await expect(upload(file('image/png', 1024))).resolves.toBeNull()
    expect(uploading.value).toBe(false)
    expect(error.value).toBe('업로드에 실패했어요')
  })

  it('용도마다 허용 형식이 다르다 — AI_ITEM은 jpeg를 받지 않는다', async () => {
    const { upload } = useUpload('AI_ITEM')

    expect(await upload(file('image/jpeg', 1024, 'a.jpg'))).toBeNull()
    expect(presign).not.toHaveBeenCalled()
  })
})
