/** 관리자 API (명세 §10). */
import { http, httpEnvelope } from '../http'
import type {
  AuditLog,
  BanUserRequest,
  ChatReportDetail,
  ChatReportListResponse,
  ChatReportStatus,
  Game,
  ReleaseSuspensionRequest,
  ReportedUser,
  SanctionHistoryListResponse,
  SanctionRefType,
  SuspendUserRequest,
  WarnUserRequest,
  SanctionStatus,
  UserReportListResponse,
} from '../types'

export const adminApi = {
  /**
   * GET /v1/admin/reports — 누적 신고 횟수순 사용자 목록(-105).
   *
   * 신고함(`/admin/user-reports`·`/admin/chat-reports`)은 **신고 한 건**이 단위지만 이 목록은
   * **사람**이 단위다. 두 신고 테이블의 건수를 합산하고, 페이지가 아니라 상한만 받는다 —
   * "많이 신고당한 사람"을 보는 화면이라 뒤쪽 페이지를 넘길 이유가 없다.
   */
  reports: (limit = 20) => httpEnvelope.get<ReportedUser[]>('/v1/admin/reports', { limit }),
  toggleGame: (gameId: number, isActive: boolean) =>
    http.patch<Game>(`/admin/games/${gameId}`, { isActive }),
  auditLogs: (page = 0) => http.get<AuditLog[]>('/admin/audit-logs', { page }),
}

/**
 * 관리자 계정 제재 (-112 후속). 채팅·사용자 신고와 같은 계열(/api/v1/admin/** + ApiResponse 래핑).
 *
 * <p><b>사용자별 조회만 있다.</b> "전체 제재 목록"은 서버에 없다 — 상태는 Redis TTL이 갖고 이력은
 * 사용자 단위로만 인덱싱돼 있어서(ix_sanction_user), 전체 스캔은 만들지 않았다. 관리자 흐름도
 * 신고에서 특정 사용자로 들어가는 형태라 대상이 항상 정해져 있다.</p>
 *
 * <p>명세서 초안(-105)의 `POST /admin/sanctions` + `{type, endsAt}`과는 계약이 다르다.
 * 기간 정지를 Redis TTL로 표현하기로 하면서 경로·본문·유형이 모두 바뀌었다(명세서 §10 참고).</p>
 */
export const adminSanctionApi = {
  /** POST /v1/admin/users/{userId}/suspension — 부과(이미 정지 중이면 새 기간으로 갱신) */
  suspend: (userId: number, body: SuspendUserRequest) =>
    httpEnvelope.post<SanctionStatus>(`/v1/admin/users/${userId}/suspension`, body),

  /** DELETE /v1/admin/users/{userId}/suspension — 기간 만료 전 수동 해제(정지 중이 아니면 409) */
  release: (userId: number, body: ReleaseSuspensionRequest) =>
    httpEnvelope.delete<void>(`/v1/admin/users/${userId}/suspension`, body),

  /**
   * POST /v1/admin/users/{userId}/warn — 경고 부과.
   *
   * 해제 엔드포인트가 없다 — 접근을 막지 않으므로 되돌릴 상태가 없다.
   * 서버가 당사자에게 개인 큐로 밀고, 못 받았으면 다음 접속 때 조회가 메운다.
   */
  warn: (userId: number, body: WarnUserRequest) =>
    httpEnvelope.post<SanctionStatus>(`/v1/admin/users/${userId}/warn`, body),

  /** POST /v1/admin/users/{userId}/ban — 영구 정지 부과(이미 밴이면 409). days가 없는 게 기간 정지와의 차이다 */
  ban: (userId: number, body: BanUserRequest) =>
    httpEnvelope.post<SanctionStatus>(`/v1/admin/users/${userId}/ban`, body),

  /** DELETE /v1/admin/users/{userId}/ban — 영구 정지 해제(밴이 아니면 409) */
  unban: (userId: number, body: ReleaseSuspensionRequest) =>
    httpEnvelope.delete<void>(`/v1/admin/users/${userId}/ban`, body),

  /**
   * GET /v1/admin/users/{userId}/sanction-status — 기간·영구 정지와 누적 횟수를 한 번에.
   *
   * 경로가 `/suspension`이 아닌 이유 — 응답이 영구 정지까지 담는다. 둘을 따로 조회하면
   * 그 사이에 상태가 바뀌어 화면이 엇갈린다.
   */
  status: (userId: number) =>
    httpEnvelope.get<SanctionStatus>(`/v1/admin/users/${userId}/sanction-status`),

  /** GET /v1/admin/users/{userId}/sanctions — 제재 이력(최신순) */
  history: (userId: number, params: { page?: number; size?: number } = {}) =>
    httpEnvelope.get<SanctionHistoryListResponse>(`/v1/admin/users/${userId}/sanctions`, params),

  /**
   * GET /v1/admin/sanctions/reports — 이 신고들 중 제재로 이어진 것(목록 배지용).
   *
   * 한 페이지분 id를 한 번에 묶어 묻는다 — 행마다 조회하면 페이지 크기만큼 요청이 나간다.
   * 물어볼 게 없으면 요청 자체를 생략한다(서버도 빈 IN 절을 만들지 않는다).
   */
  sanctionedReports: async (type: SanctionRefType, reportIds: number[]): Promise<Set<number>> => {
    if (reportIds.length === 0) return new Set()
    const res = await httpEnvelope.get<{ sanctionedReportIds: number[] }>(
      '/v1/admin/sanctions/reports',
      { type, reportIds: reportIds.join(',') },
    )
    return new Set(res.sanctionedReportIds)
  },
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
