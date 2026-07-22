/**
 * SFU(LiveKit) API — 방 접속용 미디어서버 토큰 발급 (백엔드 SfuTokenController).
 *
 * 경로가 live-rooms 하위(/v1)이고 응답이 ApiResponse 래핑이라 httpEnvelope로 호출한다.
 * 토큰은 만료(expiresIn 초)되므로 방 접속 직전에 발급받아 바로 Room.connect에 쓴다(재입장 시 재발급).
 */
import { httpEnvelope } from '../http'
import type { SfuTokenResponse } from '../types'

export const sfuApi = {
  /** GET /v1/live-rooms/{roomId}/video-token — LiveKit 접속 정보({ url, token, expiresIn }) */
  videoToken: (roomId: string) =>
    httpEnvelope.get<SfuTokenResponse>(`/v1/live-rooms/${roomId}/video-token`),
}
