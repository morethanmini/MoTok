/** 실시간 인프라 API — WebRTC ICE/TURN 자격 증명 (명세 §9). */
import { http } from '../http'
import type { IceServersResponse } from '../types'

export const rtcApi = {
  iceServers: () => http.get<IceServersResponse>('/rtc/ice-servers'),
}
