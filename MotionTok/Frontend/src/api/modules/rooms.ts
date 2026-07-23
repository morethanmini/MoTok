/**
 * 라이브룸 API (구 rooms → live-rooms, 명세 §4 / 백엔드 LiveRoomController).
 *
 * 이 리소스만의 특성 2가지:
 *  1) base(/api) 밖의 /v1 리소스 → '/v1/live-rooms'를 명시 (auth·users는 /api, live-rooms만 /api/v1).
 *  2) 응답이 ApiResponse 래핑({success,message,data}) → 공용 httpEnvelope 클라이언트로 data만 받는다.
 *
 * 제거된 엔드포인트: quick-match, 초대(invitation) 조회/발송. 초대코드는 create/detail 응답의
 * inviteCode 필드로 대체된다.
 */
import { httpEnvelope } from '../http'
import type {
  CreateLiveRoomRequest,
  CreateLiveRoomResponse,
  LiveRoomDetail,
  LiveRoomSummary,
} from '../types'

const BASE = '/v1/live-rooms'

export const roomsApi = {
  /** GET /v1/live-rooms — 전체 목록(쿼리·페이지네이션 없음, 배열 반환) */
  list: () => httpEnvelope.get<LiveRoomSummary[]>(BASE),

  /** POST /v1/live-rooms — 방 생성 */
  create: (body: CreateLiveRoomRequest) => httpEnvelope.post<CreateLiveRoomResponse>(BASE, body),

  /** GET /v1/live-rooms/{roomId} — 방 상세 */
  detail: (roomId: string) => httpEnvelope.get<LiveRoomDetail>(`${BASE}/${roomId}`),

  /** POST /v1/live-rooms/{roomId}/join — roomId로 직접 입장(비공개방이면 password 필요) */
  join: (roomId: string, password?: string) =>
    httpEnvelope.post<LiveRoomDetail>(`${BASE}/${roomId}/join`, { password }),

  /** POST /v1/live-rooms/join-by-invite-code — 초대코드로 입장(비밀번호 검증 없음) */
  joinByInviteCode: (inviteCode: string) =>
    httpEnvelope.post<LiveRoomDetail>(`${BASE}/join-by-invite-code`, { inviteCode }),

  /** POST /v1/live-rooms/quick-start — 빠른 시작(랜덤 매칭, -27). 조건 맞는 방을 서버가 골라 입장시킨다. */
  quickStart: () => httpEnvelope.post<LiveRoomDetail>(`${BASE}/quick-start`),

  /** DELETE /v1/live-rooms/{roomId}/members/me — 방 나가기(멱등). 마지막 인원이면 방 즉시 삭제. */
  leave: (roomId: string) => httpEnvelope.delete<void>(`${BASE}/${roomId}/members/me`),
}
