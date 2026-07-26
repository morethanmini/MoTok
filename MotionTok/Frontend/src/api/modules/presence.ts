/** 접속 상태 API — 친구 목록의 presence를 채우는 하트비트(-57, 키맵 ⑥ presence:{userId}). */
import { http } from '../http'
import type { HeartbeatResponse } from '../types'

export const presenceApi = {
  /** 살아 있음을 알리고 현재 방을 갱신한다. 방 밖이면 roomId는 null. */
  heartbeat: (roomId: string | null) =>
    http.post<HeartbeatResponse>('/presence/heartbeat', { roomId }),
}
