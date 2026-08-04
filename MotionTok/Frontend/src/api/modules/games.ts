/** 게임 API (명세 §5). */
import { http } from '../http'
import type {
  Constellation,
  Game,
  GameDetail,
  LeaderboardMode,
  LeaderboardPeriod,
  LeaderboardResponse,
} from '../types'

export const gamesApi = {
  list: (playerCount?: number) => http.get<Game[]>('/games', { playerCount }),
  detail: (gameId: number) => http.get<GameDetail>(`/games/${gameId}`),
  /**
   * 게임·모드·기간별 랭킹.
   *
   * `week`는 보고 싶은 주의 <b>아무 날짜나</b>(YYYY-MM-DD) 주면 서버가 그 주 월요일로 스냅한다 —
   * 주 경계 계산을 클라이언트가 따라 하면 서버와 어긋날 수 있어 그냥 넘긴다. 생략하면 이번 주.
   *
   * `chart`는 period='CHART'일 때 어느 번들 채보의 보드인지(예: ssafy-fighting-manual).
   * 이벤트용이라 이벤트가 끝나면 이 인자와 'CHART'를 같이 걷어낸다(S15P11A706-186).
   */
  leaderboard: (
    gameId: number,
    mode: LeaderboardMode = 'MULTI',
    limit = 20,
    period: LeaderboardPeriod = 'ALLTIME',
    week?: string,
    chart?: string,
  ) => http.get<LeaderboardResponse>(`/games/${gameId}/leaderboard`, { mode, limit, period, week, chart }),
  constellations: () => http.get<Constellation[]>('/games/constellations'),

  /**
   * 그림으로 말해요 완성 그림 AI 채점 요청 (명세 v0.2.22).
   * 채점은 서버가 GMS를 호출해 점수까지 계산한다 — 배포 환경에서 키를 프론트에 둘 수 없기 때문.
   * 결과는 이 응답이 아니라 방 토픽의 DRAW_RESULT·GAME_END로 전원에게 배포된다.
   */
  judgeDrawing: (roomId: string, image: string) =>
    http.post<void>('/games/draw/judge', { roomId, image }),
}
