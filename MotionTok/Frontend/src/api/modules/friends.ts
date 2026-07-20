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
  remove: (friendId: number) => http.delete<void>(`/friends/${friendId}`),
  room: (friendId: number) => http.get<FriendRoomResponse>(`/friends/${friendId}/room`),
}
