/** 방 API (명세 §4). */
import { http } from '../http'
import type {
  CreateRoomRequest,
  CreateRoomResponse,
  InvitationInfo,
  JoinResult,
  QuickMatchResponse,
  RoomDetail,
  RoomListResponse,
} from '../types'

export const roomsApi = {
  list: (keyword?: string, page = 0) => http.get<RoomListResponse>('/rooms', { keyword, page }),
  create: (body: CreateRoomRequest) => http.post<CreateRoomResponse>('/rooms', body),
  detail: (roomId: string) => http.get<RoomDetail>(`/rooms/${roomId}`),
  quickMatch: () => http.post<QuickMatchResponse>('/rooms/quick-match'),
  joinByCode: (inviteCode: string) =>
    http.post<JoinResult>('/rooms/join-by-code', { inviteCode }),
  joinPublic: (roomId: string) => http.post<JoinResult>(`/rooms/${roomId}/participants`),
  getInvitation: (roomId: string) => http.get<InvitationInfo>(`/rooms/${roomId}/invitation`),
  inviteFriend: (roomId: string, friendId: number) =>
    http.post<void>(`/rooms/${roomId}/invitations`, { friendId }),
}
