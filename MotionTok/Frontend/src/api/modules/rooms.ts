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
import { API_BASE, httpEnvelope } from '../http'
import { getAccessToken } from '../token'
import type {
  CreateLiveRoomRequest,
  CreateLiveRoomResponse,
  LiveRoomDetail,
  LiveRoomListResponse,
  LiveRoomPasswordResponse,
  UpdateLiveRoomRequest,
} from '../types'

const BASE = '/v1/live-rooms'

export const roomsApi = {
  /** GET /v1/live-rooms?page= — 페이지당 6개 고정, page 생략 시 1. 최신 생성 순. */
  list: (page = 1) => httpEnvelope.get<LiveRoomListResponse>(BASE, { page }),

  /** POST /v1/live-rooms — 방 생성 */
  create: (body: CreateLiveRoomRequest) => httpEnvelope.post<CreateLiveRoomResponse>(BASE, body),

  /** GET /v1/live-rooms/{roomId} — 방 상세 */
  detail: (roomId: string) => httpEnvelope.get<LiveRoomDetail>(`${BASE}/${roomId}`),

  /**
   * GET /v1/live-rooms/{roomId}/password — 방 설정 폼 비밀번호 프리필용(방장 전용, -130).
   * 공개방이면 password는 null. 방장 아니면 403(ROOM_NOT_HOST).
   */
  password: (roomId: string) =>
    httpEnvelope.get<LiveRoomPasswordResponse>(`${BASE}/${roomId}/password`),

  /**
   * PATCH /v1/live-rooms/{roomId} — 방 정보 수정(방장·대기실 전용, -130).
   * 전체 상태 재전송이라 4필드를 모두 보낸다. 게임 중이면 409(ROOM_GAME_IN_PROGRESS),
   * 방장 아니면 403(ROOM_NOT_HOST), 정원을 현재 인원 아래로 줄이면 409.
   */
  update: (roomId: string, body: UpdateLiveRoomRequest) =>
    httpEnvelope.patch<LiveRoomDetail>(`${BASE}/${roomId}`, body),

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

  /**
   * 문서 언로드(탭 닫기·주소창 이탈·새로고침) 전용 퇴장 통보.
   * 문서가 내려가는 중이라 응답을 기다릴 수 없어 keepalive로 쏜다 — sendBeacon은 POST만
   * 가능해서 fetch keepalive를 쓴다. leave가 멱등이라 SPA 경로와 중복 발사돼도 안전하다.
   */
  leaveOnUnload: (roomId: string) => {
    const token = getAccessToken()
    void fetch(`${API_BASE}${BASE}/${roomId}/members/me`, {
      method: 'DELETE',
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).catch(() => {
      // 언로드 중 실패는 복구 불가 — 조용히 무시
    })
  },
}
