/** 관리자 API (명세 §10). */
import { http, httpEnvelope } from '../http'
import type {
  AuditLog,
  ChatReportDetail,
  ChatReportListResponse,
  ChatReportStatus,
  Game,
  ReportedUser,
  Sanction,
  SanctionRequest,
  UserReportListResponse,
} from '../types'

export const adminApi = {
  reports: () => http.get<ReportedUser[]>('/admin/reports'),
  sanctions: () => http.get<Sanction[]>('/admin/sanctions'),
  applySanction: (body: SanctionRequest) => http.post<Sanction>('/admin/sanctions', body),
  toggleGame: (gameId: number, isActive: boolean) =>
    http.patch<Game>(`/admin/games/${gameId}`, { isActive }),
  auditLogs: (page = 0) => http.get<AuditLog[]>('/admin/audit-logs', { page }),
}

/**
 * 관리자 채팅 신고 (v0.2.17, S15P11A706-133 — 백엔드 구현 완료).
 * /api/v1/admin/** + ApiResponse 래핑 → httpEnvelope. AccessToken role claim이 ADMIN이어야 한다
 * (role claim 도입 전 구 토큰은 재로그인 필요).
 */
/**
 * 관리자 사용자 신고 (-112). 채팅 신고와 같은 계열(/api/v1/admin/** + ApiResponse 래핑).
 * 상세 조회는 없다 — 사용자 신고는 "누가 누구를 왜 신고했다"가 곧 전부라 목록 행에 다 들어간다
 * (채팅 신고처럼 복원할 전후 맥락 스냅샷이 없다).
 */
export const adminUserReportsApi = {
  /** GET /v1/admin/user-reports — 목록(최신순). status 생략 시 전체 */
  list: (params: { status?: ChatReportStatus; page?: number; size?: number } = {}) =>
    httpEnvelope.get<UserReportListResponse>('/v1/admin/user-reports', params),

  /** PATCH /v1/admin/user-reports/{id}/status — 처리 상태 전이(RECEIVED로 되돌리기 불가) */
  updateStatus: (reportId: number, status: Exclude<ChatReportStatus, 'RECEIVED'>) =>
    httpEnvelope.patch<void>(`/v1/admin/user-reports/${reportId}/status`, { status }),
}

export const adminChatReportsApi = {
  /** GET /v1/admin/chat-reports — 목록(최신순). status 생략 시 전체 */
  list: (params: { status?: ChatReportStatus; page?: number; size?: number } = {}) =>
    httpEnvelope.get<ChatReportListResponse>('/v1/admin/chat-reports', params),

  /** GET /v1/admin/chat-reports/{id} — 상세(전후 맥락 스냅샷 포함) */
  detail: (reportId: number) =>
    httpEnvelope.get<ChatReportDetail>(`/v1/admin/chat-reports/${reportId}`),

  /** PATCH /v1/admin/chat-reports/{id}/status — 처리 상태 전이(RECEIVED로 되돌리기 불가) */
  updateStatus: (reportId: number, status: Exclude<ChatReportStatus, 'RECEIVED'>) =>
    httpEnvelope.patch<void>(`/v1/admin/chat-reports/${reportId}/status`, { status }),
}
