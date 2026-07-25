/** 신고 API (명세 §7). */
import { http, httpEnvelope } from '../http'
import type { ChatReportCreateRequest, ChatReportCreateResponse, ReportRequest } from '../types'

export const reportsApi = {
  /** POST /reports — 유저 신고 (백엔드 설계 단계, 미구현) */
  report: (body: ReportRequest) => http.post<void>('/reports', body),
}

/**
 * 채팅 신고 (v0.2.17, S15P11A706-132). /api/v1 + ApiResponse 래핑 리소스라 httpEnvelope 사용.
 * 회원 전용(게스트 403) · 방 참가자만 · 방 폭파 후에는 로그가 즉시 삭제되어 신고 불가.
 */
export const chatReportsApi = {
  /** POST /v1/chat-reports — 특정 채팅(chatId) 신고. 201 → { reportId } */
  create: (body: ChatReportCreateRequest) =>
    httpEnvelope.post<ChatReportCreateResponse>('/v1/chat-reports', body),
}
