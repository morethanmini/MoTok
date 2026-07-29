import { http } from '../http'
import type { WhisperMessage } from '../types'

/**
 * 친구 귓속말(-150). 실시간 배달은 STOMP가 하고, 이 REST는 대화창을 열 때 지난 대화를
 * 한 번 채우는 용도다 — 실시간 채널은 델타만 주므로 시작점은 스냅샷이 필요하다.
 *
 * 경로가 /friends 아래인 것은 서버 인가 규칙(회원 전용)을 그대로 타기 위해서다.
 * 친구 도메인 규약에 맞춰 ApiResponse로 감싸지 않는다.
 */
export const whispersApi = {
  /** GET /friends/{userId}/whispers — 그 친구와의 최근 대화(시간순). */
  history: (userId: number) => http.get<WhisperMessage[]>(`/friends/${userId}/whispers`),
  /** GET /friends/whispers/pending — 오프라인 동안 도착한 귓속말을 비우면서 받아온다(-160). */
  pending: () => http.get<WhisperMessage[]>('/friends/whispers/pending'),
}
