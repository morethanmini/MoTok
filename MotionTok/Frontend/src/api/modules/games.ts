/** 게임 API (명세 §5). */
import { http } from '../http'
import type { Constellation, Game, GameDetail, LeaderboardMode, LeaderboardResponse } from '../types'

export const gamesApi = {
  list: (playerCount?: number) => http.get<Game[]>('/games', { playerCount }),
  detail: (gameId: number) => http.get<GameDetail>(`/games/${gameId}`),
  leaderboard: (gameId: number, mode: LeaderboardMode = 'MULTI', limit = 20) =>
    http.get<LeaderboardResponse>(`/games/${gameId}/leaderboard`, { mode, limit }),
  constellations: () => http.get<Constellation[]>('/games/constellations'),

  /**
   * 그림으로 말해요 완성 그림 AI 채점 요청 (명세 v0.2.22).
   * 채점은 서버가 GMS를 호출해 점수까지 계산한다 — 배포 환경에서 키를 프론트에 둘 수 없기 때문.
   * 결과는 이 응답이 아니라 방 토픽의 DRAW_RESULT·GAME_END로 전원에게 배포된다.
   */
  judgeDrawing: (roomId: string, image: string) =>
    http.post<void>('/games/draw/judge', { roomId, image }),
}
