/** 게임 API (명세 §5). */
import { http } from '../http'
import type { Constellation, Game, GameDetail, LeaderboardResponse } from '../types'

export const gamesApi = {
  list: (playerCount?: number) => http.get<Game[]>('/games', { playerCount }),
  detail: (gameId: number) => http.get<GameDetail>(`/games/${gameId}`),
  leaderboard: (gameId: number, limit = 20) =>
    http.get<LeaderboardResponse>(`/games/${gameId}/leaderboard`, { limit }),
  constellations: () => http.get<Constellation[]>('/games/constellations'),
}
