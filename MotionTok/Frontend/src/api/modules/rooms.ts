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
  ChatMessage,
  CreateLiveRoomRequest,
  CreateLiveRoomResponse,
  LiveRoomDetail,
  LiveRoomListResponse,
  LiveRoomPasswordResponse,
  UpdateLiveRoomRequest,
} from '../types'

const BASE = '/v1/live-rooms'

export type KickReason = 'MANNER_VIOLATION' | 'INAPPROPRIATE_PROFILE' | 'GAME_DISRUPTION' | 'SPAM_AD' | 'OTHER'

export const roomsApi = {
  /** GET /v1/live-rooms?page= — 페이지당 6개 고정, page 생략 시 1. 최신 생성 순. */
  list: (page = 1) => httpEnvelope.get<LiveRoomListResponse>(BASE, { page }),

  /** POST /v1/live-rooms — 방 생성 */
  create: (body: CreateLiveRoomRequest) => httpEnvelope.post<CreateLiveRoomResponse>(BASE, body),

  /**
   * POST /v1/live-rooms/{roomId}/open — 방을 로비 목록에 공개(방장 전용).
   *
   * 방은 생성만으로는 목록에 뜨지 않는다. 방장이 기기 점검을 마치고 게임방에 실제로 들어온 뒤
   * 이 호출로 공개해야 로비·빠른 시작의 대상이 된다 — 방장 없는 방에 남이 들어가 무한정
   * 기다리는 상황을 없애기 위해서다. 멱등이라 여러 번 불려도 안전하다.
   */
  open: (roomId: string) => httpEnvelope.post<void>(`${BASE}/${roomId}/open`),

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

  /**
   * GET /v1/live-rooms/{roomId}/chats — 재입장(새로고침) 시 채팅 이력 복원(-164, 멤버 전용).
   * 원소는 STOMP 브로드캐스트(ChatMessage)와 같은 모양. TALK만 온다(제안 카드는 실시간 전용).
   */
  chatHistory: (roomId: string) => httpEnvelope.get<ChatMessage[]>(`${BASE}/${roomId}/chats`),

  /** DELETE /v1/live-rooms/{roomId}/members/me — 방 나가기(멱등). 마지막 인원이면 방 즉시 삭제. */
  leave: (roomId: string) => httpEnvelope.delete<void>(`${BASE}/${roomId}/members/me`),

  /** POST /v1/live-rooms/{roomId}/members/{userId}/kick — 방장이 사유와 함께 참가자를 강퇴. */
  kick: (roomId: string, userId: string, reason: KickReason) =>
    httpEnvelope.post<void>(`${BASE}/${roomId}/members/${userId}/kick`, { reason }),

  /**
   * POST /v1/live-rooms/{roomId}/members/{userId}/delegate-host — 방장을 이 참가자에게 넘긴다(-180).
   * 방장·대기실(WAITING) 전용. 결과는 HOST_CHANGED 방송으로 방 전원에게 돌아온다.
   */
  delegateHost: (roomId: string, userId: string) =>
    httpEnvelope.post<void>(`${BASE}/${roomId}/members/${userId}/delegate-host`),

  /**
   * 문서 언로드(탭 닫기·주소창 이탈·새로고침) 전용 퇴장 통보.
   * 문서가 내려가는 중이라 응답을 기다릴 수 없어 keepalive로 쏜다 — sendBeacon은 POST만
   * 가능해서 fetch keepalive를 쓴다. leave가 멱등이라 SPA 경로와 중복 발사돼도 안전하다.
   *
   * unload=true(-164): 서버는 즉시 제거하지 않고 유예를 둔다 — 새로고침이면 복귀한 페이지의
   * join이 유예 안에 도착해 퇴장이 없던 일이 되고(방장·멤버십 유지), 진짜 탭 닫기면 유예 뒤
   * 일반 퇴장(방장 이양·빈방 삭제)이 실행된다.
   */
  leaveOnUnload: (roomId: string) => {
    const token = getAccessToken()
    void fetch(`${API_BASE}${BASE}/${roomId}/members/me?unload=true`, {
      method: 'DELETE',
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).catch(() => {
      // 언로드 중 실패는 복구 불가 — 조용히 무시
    })
  },
}
