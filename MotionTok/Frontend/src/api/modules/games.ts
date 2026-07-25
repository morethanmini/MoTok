/** 게임 API (명세 §5). */
import { http } from '../http'
import type { Constellation, Game, GameDetail, LeaderboardMode, LeaderboardResponse } from '../types'

export const gamesApi = {
  list: (playerCount?: number) => http.get<Game[]>('/games', { playerCount }),
  detail: (gameId: number) => http.get<GameDetail>(`/games/${gameId}`),
  leaderboard: (gameId: number, mode: LeaderboardMode = 'MULTI', limit = 20) =>
    http.get<LeaderboardResponse>(`/games/${gameId}/leaderboard`, { mode, limit }),
  constellations: () => http.get<Constellation[]>('/games/constellations'),
}
