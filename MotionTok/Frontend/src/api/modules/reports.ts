/** 신고 API (명세 §7). */
import { http, httpEnvelope } from '../http'
import type {
  ChatReportCreateRequest,
  ChatReportCreateResponse,
  ReportCreateResponse,
  ReportRequest,
} from '../types'

export const reportsApi = {
  /**
   * POST /reports — 사용자 신고(-112). 프로필 화면에서 특정 회원을 신고한다.
   * 회원 전용(게스트 403). 피신고자 닉네임은 보내지 않는다 — 서버가 userId로 조회해 기록한다.
   * 이미 처리 중인 신고가 있으면 409(USER_REPORT_DUPLICATE).
   */
  report: (body: ReportRequest) => http.post<ReportCreateResponse>('/reports', body),
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
