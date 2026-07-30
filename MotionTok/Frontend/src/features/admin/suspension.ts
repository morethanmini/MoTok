/**
 * 계정 정지 부과 화면의 순수 로직 — 입력 검증·기간 표기·에러 문구.
 *
 * 뷰에서 떼어낸 이유는 검증 경계가 서버와 <b>정확히</b> 같아야 하기 때문이다. 화면이 통과시킨
 * 값을 서버가 400으로 거절하면 관리자는 사유를 다시 쓰게 되고, 반대로 화면이 더 좁으면
 * 서버가 허용하는 제재를 걸 수 없다. 그 경계를 여기 한 곳에 두고 테스트로 고정한다.
 */
import type { SanctionRefType, SanctionType } from '@/api'

/** 서버 @Min(1) @Max(365)와 같은 값. 365를 넘는 제재는 영구 정지로 표현해야 할 다른 결정이다. */
export const MIN_SUSPENSION_DAYS = 1
export const MAX_SUSPENSION_DAYS = 365

/** 서버 @Size(max = 200)과 같은 값. */
export const MAX_SUSPENSION_REASON_LENGTH = 200

/** 자주 쓰는 기간 — 관리자가 매번 숫자를 타이핑하지 않게 한다. 직접 입력도 가능하다. */
export const SUSPENSION_DAY_PRESETS = [1, 3, 7, 30] as const

export const SANCTION_TYPE_LABEL: Record<SanctionType, string> = {
  WARN: '경고',
  SUSPEND: '기간 정지',
  RELEASE: '정지 해제',
  BAN: '영구 정지',
  UNBAN: '영구 해제',
}

const SANCTION_REF_LABEL: Record<SanctionRefType, string> = {
  USER_REPORT: '사용자 신고',
  CHAT_REPORT: '채팅 신고',
}

/**
 * 제재 이력의 근거 신고 표기.
 *
 * 유형을 함께 찍는 이유는 두 신고 테이블의 id가 각각 1부터 증가해서다 — "#7"만 보여 주면
 * 관리자가 어느 목록에서 7번을 찾아야 하는지 알 수 없다. 직권 제재는 가리킬 신고가 없다.
 */
export function sanctionRefLabel(
  refReportId: number | null,
  refReportType: SanctionRefType | null,
): string {
  if (refReportId === null || refReportType === null) return '직권'
  return `${SANCTION_REF_LABEL[refReportType]} #${refReportId}`
}

/**
 * 부과 가능 여부. 사유는 서버가 {@code @NotBlank}라 공백만은 통과하지 못하고,
 * 일수는 정수만 받는다 — 소수점을 보내면 Jackson이 int로 잘라 의도와 다른 기간이 걸린다.
 */
export function canSubmitSuspension(days: number, reason: string): boolean {
  if (!Number.isInteger(days)) return false
  if (days < MIN_SUSPENSION_DAYS || days > MAX_SUSPENSION_DAYS) return false
  const trimmed = reason.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_SUSPENSION_REASON_LENGTH
}

/**
 * 해제도 사유가 필수다(서버 @NotBlank) — 부과와 같은 규칙을 쓴다.
 * 영구 정지 부과도 기간이 없어 검증이 사유뿐이라 이 함수를 공유한다.
 */
export function canSubmitRelease(reason: string): boolean {
  const trimmed = reason.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_SUSPENSION_REASON_LENGTH
}

/**
 * 남은 정지 기간 표기. TTL을 읽은 값이라 초 단위 오차가 있어 <b>분 미만은 버린다</b> —
 * "3일 4시간 12분 7초"는 관리자가 판단에 쓰지 않는 정밀도이고, 매초 바뀌는 숫자로만 보인다.
 */
export function formatRemaining(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) return '—'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`
  if (hours > 0) return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`
  return minutes > 0 ? `${minutes}분` : '1분 미만'
}

/**
 * 제재 API 에러 문구. 모르는 코드는 서버 메시지를 그대로 보여 준다 —
 * 관리자 화면에서 원인을 숨기면 "왜 안 되는지 모르는 실패"만 남는다.
 */
export function suspensionErrorMessage(code: string, serverMessage: string): string {
  switch (code) {
    case 'SANCTION_SELF_FORBIDDEN':
      return '자기 자신은 제재할 수 없어요'
    case 'SANCTION_TARGET_ADMIN':
      return '관리자는 제재할 수 없어요'
    case 'SANCTION_NOT_SUSPENDED':
      return '정지 중인 계정이 아니에요'
    case 'SANCTION_ALREADY_BANNED':
      return '이미 영구 정지된 계정이에요'
    case 'SANCTION_NOT_BANNED':
      return '영구 정지된 계정이 아니에요'
    case 'USER_NOT_FOUND':
      return '없거나 이미 탈퇴한 계정이에요'
    default:
      return serverMessage || '제재 처리에 실패했어요'
  }
}
