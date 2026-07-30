import { describe, it, expect } from 'vitest'

import {
  MAX_SUSPENSION_DAYS,
  MAX_SUSPENSION_REASON_LENGTH,
  SANCTION_TYPE_LABEL,
  SUSPENSION_DAY_PRESETS,
  canSubmitRelease,
  canSubmitSuspension,
  formatRemaining,
  sanctionRefLabel,
  suspensionErrorMessage,
} from '../features/admin/suspension'

describe('계정 정지 부과 검증 (S15P11A706-105)', () => {
  it('기간은 1~365일 — 서버 @Min(1) @Max(365)와 같은 경계', () => {
    expect(canSubmitSuspension(0, '욕설 반복')).toBe(false)
    expect(canSubmitSuspension(1, '욕설 반복')).toBe(true)
    expect(canSubmitSuspension(MAX_SUSPENSION_DAYS, '욕설 반복')).toBe(true)
    expect(canSubmitSuspension(MAX_SUSPENSION_DAYS + 1, '욕설 반복')).toBe(false)
  })

  it('소수점 기간은 거부한다 — 서버가 int로 잘라 의도와 다른 기간이 걸린다', () => {
    expect(canSubmitSuspension(1.5, '욕설 반복')).toBe(false)
    expect(canSubmitSuspension(Number.NaN, '욕설 반복')).toBe(false)
  })

  it('사유는 필수이고 공백만은 불가 (서버 @NotBlank)', () => {
    expect(canSubmitSuspension(3, '')).toBe(false)
    expect(canSubmitSuspension(3, '   ')).toBe(false)
    expect(canSubmitSuspension(3, '욕설 반복')).toBe(true)
  })

  it('사유 200자 초과는 거부 (서버 @Size(max=200))', () => {
    expect(canSubmitSuspension(3, 'a'.repeat(MAX_SUSPENSION_REASON_LENGTH))).toBe(true)
    expect(canSubmitSuspension(3, 'a'.repeat(MAX_SUSPENSION_REASON_LENGTH + 1))).toBe(false)
  })

  it('해제도 사유가 필수다 — 오판 정정 역시 이력에 남는 결정이다', () => {
    expect(canSubmitRelease('')).toBe(false)
    expect(canSubmitRelease('  ')).toBe(false)
    expect(canSubmitRelease('오판으로 확인')).toBe(true)
  })

  it('기간 프리셋은 모두 유효 범위 안이다', () => {
    for (const days of SUSPENSION_DAY_PRESETS) {
      expect(canSubmitSuspension(days, '사유')).toBe(true)
    }
  })
})

describe('남은 정지 기간 표기', () => {
  it('일 단위가 있으면 시간까지만, 분·초는 버린다', () => {
    expect(formatRemaining(3 * 86_400 + 4 * 3_600 + 12 * 60 + 7)).toBe('3일 4시간')
    expect(formatRemaining(3 * 86_400)).toBe('3일')
  })

  it('하루 미만은 시간·분으로', () => {
    expect(formatRemaining(4 * 3_600 + 30 * 60)).toBe('4시간 30분')
    expect(formatRemaining(4 * 3_600)).toBe('4시간')
    expect(formatRemaining(30 * 60)).toBe('30분')
  })

  it('1분 미만도 정지 중이라는 사실은 남는다 — 0으로 접으면 정상 계정처럼 보인다', () => {
    expect(formatRemaining(42)).toBe('1분 미만')
  })

  it('정지 중이 아니면 대시 — TTL이 없으면 서버가 null을 준다', () => {
    expect(formatRemaining(null)).toBe('—')
    expect(formatRemaining(undefined)).toBe('—')
    expect(formatRemaining(0)).toBe('—')
  })
})

describe('제재 근거 신고 표기', () => {
  it('유형까지 찍는다 — 두 신고 테이블의 id가 각각 1부터 증가해 "#7"만으로는 못 찾는다', () => {
    expect(sanctionRefLabel(7, 'USER_REPORT')).toBe('사용자 신고 #7')
    expect(sanctionRefLabel(7, 'CHAT_REPORT')).toBe('채팅 신고 #7')
  })

  it('직권 제재는 가리킬 신고가 없다', () => {
    expect(sanctionRefLabel(null, null)).toBe('직권')
  })

  it('한쪽만 있는 값도 직권으로 접는다 — 서버가 짝을 강제하므로 실제로는 오지 않는다', () => {
    expect(sanctionRefLabel(7, null)).toBe('직권')
    expect(sanctionRefLabel(null, 'USER_REPORT')).toBe('직권')
  })
})

describe('제재 유형 라벨', () => {
  it('경고·기간·영구를 구분한다 — 이력에서 같은 이름이면 무슨 제재였는지 알 수 없다', () => {
    expect(SANCTION_TYPE_LABEL.WARN).toBe('경고')
    expect(SANCTION_TYPE_LABEL.SUSPEND).toBe('기간 정지')
    expect(SANCTION_TYPE_LABEL.BAN).toBe('영구 정지')
    expect(SANCTION_TYPE_LABEL.RELEASE).toBe('정지 해제')
    expect(SANCTION_TYPE_LABEL.UNBAN).toBe('영구 해제')
  })

  it('경고 부과 검증은 사유뿐이다 — 기간이 없는 게 정지와의 차이다', () => {
    expect(canSubmitRelease('')).toBe(false)
    expect(canSubmitRelease('도배가 반복됩니다')).toBe(true)
    expect(canSubmitRelease('a'.repeat(MAX_SUSPENSION_REASON_LENGTH + 1))).toBe(false)
  })
})

describe('제재 에러 문구', () => {
  it('알려진 코드는 친화적 문구로 바꾼다', () => {
    expect(suspensionErrorMessage('SANCTION_SELF_FORBIDDEN', '')).toBe('자기 자신은 제재할 수 없어요')
    expect(suspensionErrorMessage('SANCTION_TARGET_ADMIN', '')).toBe('관리자는 제재할 수 없어요')
    expect(suspensionErrorMessage('SANCTION_NOT_SUSPENDED', '')).toBe('정지 중인 계정이 아니에요')
    expect(suspensionErrorMessage('SANCTION_ALREADY_BANNED', '')).toBe('이미 영구 정지된 계정이에요')
    expect(suspensionErrorMessage('SANCTION_NOT_BANNED', '')).toBe('영구 정지된 계정이 아니에요')
    expect(suspensionErrorMessage('USER_NOT_FOUND', '')).toBe('없거나 이미 탈퇴한 계정이에요')
  })

  it('모르는 코드는 서버 메시지를 그대로 — 관리자 화면에서 원인을 숨기면 안 된다', () => {
    expect(suspensionErrorMessage('SOME_NEW_CODE', '서버가 준 메시지')).toBe('서버가 준 메시지')
    expect(suspensionErrorMessage('SOME_NEW_CODE', '')).toBe('제재 처리에 실패했어요')
  })
})
