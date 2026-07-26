/** 친구 API (명세 §6). */
import { http } from '../http'
import type { Friend, FriendRequestItem, FriendRoomResponse } from '../types'

export const friendsApi = {
  list: () => http.get<Friend[]>('/friends'),
  requests: (direction?: 'received' | 'sent') =>
    http.get<FriendRequestItem[]>('/friends/requests', { direction }),
  sendRequest: (targetNickname: string) =>
    http.post<FriendRequestItem>('/friends/requests', { targetNickname }),
  respond: (requestId: number, action: 'ACCEPT' | 'REJECT') =>
    http.patch<void>(`/friends/requests/${requestId}`, { action }),
  /** 내가 보낸 요청 철회. 수락·거절(respond)은 받는 쪽 동작이라 엔드포인트를 나눈다. */
  cancelRequest: (requestId: number) => http.delete<void>(`/friends/requests/${requestId}`),
  remove: (friendId: number) => http.delete<void>(`/friends/${friendId}`),
  room: (friendId: number) => http.get<FriendRoomResponse>(`/friends/${friendId}/room`),
}
