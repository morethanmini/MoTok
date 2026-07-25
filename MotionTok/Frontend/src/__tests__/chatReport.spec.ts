import { describe, it, expect } from 'vitest'

import {
  CHAT_REPORT_REASONS,
  canSubmitChatReport,
  chatReportErrorMessage,
} from '../features/game-room/chatReport'

describe('채팅 신고 제출 검증 (S15P11A706-132)', () => {
  it('사유를 고르지 않으면 제출 불가', () => {
    expect(canSubmitChatReport(null, '')).toBe(false)
  })

  it('ETC가 아닌 사유는 상세 없이 제출 가능', () => {
    expect(canSubmitChatReport('ABUSE', '')).toBe(true)
  })

  it('ETC는 상세 입력이 있어야 제출 가능 (공백만은 불가)', () => {
    expect(canSubmitChatReport('ETC', '')).toBe(false)
    expect(canSubmitChatReport('ETC', '   ')).toBe(false)
    expect(canSubmitChatReport('ETC', '심한 도발을 반복함')).toBe(true)
  })

  it('상세 200자 초과는 제출 불가 (백엔드 @Size(max=200)와 동일)', () => {
    expect(canSubmitChatReport('ABUSE', 'a'.repeat(201))).toBe(false)
    expect(canSubmitChatReport('ABUSE', 'a'.repeat(200))).toBe(true)
  })

  it('사유 코드 5종은 백엔드 ReportReason enum과 일치한다', () => {
    expect(CHAT_REPORT_REASONS.map((r) => r.code)).toEqual([
      'ABUSE', 'HATE', 'SEXUAL', 'SPAM', 'ETC',
    ])
  })

  it('알려진 에러 코드는 친화적 문구로, 모르는 코드는 서버 메시지로 안내한다', () => {
    expect(chatReportErrorMessage('CHAT_REPORT_DUPLICATE', '')).toBe('이미 신고한 메시지예요')
    expect(chatReportErrorMessage('CHAT_REPORT_SELF', '')).toBe('내 메시지는 신고할 수 없어요')
    expect(chatReportErrorMessage('ROOM_NOT_FOUND', '')).toBe('메시지가 만료되어 신고할 수 없어요')
    expect(chatReportErrorMessage('SOME_NEW_CODE', '서버가 준 메시지')).toBe('서버가 준 메시지')
    expect(chatReportErrorMessage('SOME_NEW_CODE', '')).toBe('신고 접수에 실패했어요')
  })
})
