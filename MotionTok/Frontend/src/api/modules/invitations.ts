/**
 * 방 초대 API (-100).
 *
 * 발송만 방에 매달린 하위 리소스라 /v1/live-rooms 아래에 있고, 조회·삭제는 "내가 받은 것"이라
 * /invitations에 있다. 경로는 /v1이지만 응답은 ApiResponse로 감싸지 않으므로(백엔드
 * InvitationController) live-rooms용 httpEnvelope가 아니라 비래핑 http 클라이언트를 쓴다.
 */
import { http } from '../http'
import type { InvitationItem } from '../types'

export const invitationsApi = {
  /** POST /v1/live-rooms/{roomId}/invitations — 대기 중인 방으로 친구를 부른다(202). */
  send: (roomId: string, friendId: number) =>
    http.post<void>(`/v1/live-rooms/${roomId}/invitations`, { friendId }),

  /** GET /invitations — 내가 받은, 아직 살아 있는 초대. 최신순. */
  received: () => http.get<InvitationItem[]>('/invitations'),

  /**
   * DELETE /invitations/{invitationId} — 초대를 치운다.
   * 거절은 곧 이 호출이고, 수락은 joinByInviteCode로 입장한 **뒤에** 부른다 —
   * 먼저 지우면 정원이 찼을 때 다시 눌러 볼 초대가 사라진다.
   */
  dismiss: (invitationId: string) => http.delete<void>(`/invitations/${invitationId}`),
}
