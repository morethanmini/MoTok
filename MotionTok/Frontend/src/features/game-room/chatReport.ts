/**
 * 채팅 신고(v0.2.17, S15P11A706-132) — 모달의 순수 로직 분리(단위 테스트 대상).
 * 사유 5종은 백엔드 ReportReason enum과 1:1 — 서버가 검증하므로 임의 문자열 불가.
 */
import type { ChatReportReason } from '@/api'

export const CHAT_REPORT_REASONS: ReadonlyArray<{ code: ChatReportReason; label: string }> = [
  { code: 'ABUSE', label: '욕설·비방' },
  { code: 'HATE', label: '혐오·차별' },
  { code: 'SEXUAL', label: '음란·성희롱' },
  { code: 'SPAM', label: '도배·광고' },
  { code: 'ETC', label: '기타(입력)' },
]

export const CHAT_REPORT_DETAIL_MAX = 200

/** 제출 가능 여부 — 사유 필수, ETC는 상세 입력 필수, 상세는 200자 이내. */
export function canSubmitChatReport(reason: ChatReportReason | null, detail: string): boolean {
  if (!reason) return false
  const trimmed = detail.trim()
  if (trimmed.length > CHAT_REPORT_DETAIL_MAX) return false
  if (reason === 'ETC' && !trimmed) return false
  return true
}

/** 서버 에러 코드 → 사용자 안내 문구. 모르는 코드는 서버 메시지(fallback)를 그대로 쓴다. */
export function chatReportErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'CHAT_REPORT_DUPLICATE':
      return '이미 신고한 메시지예요'
    case 'CHAT_REPORT_SELF':
      return '내 메시지는 신고할 수 없어요'
    case 'CHAT_MESSAGE_NOT_FOUND':
    case 'ROOM_NOT_FOUND':
      return '메시지가 만료되어 신고할 수 없어요'
    case 'CHAT_REPORT_NOT_IN_ROOM':
      return '방 참가자만 신고할 수 있어요'
    case 'COMMON_FORBIDDEN':
      return '회원만 신고할 수 있어요'
    default:
      return fallback || '신고 접수에 실패했어요'
  }
}
