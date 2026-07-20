/** 콘텐츠 API — 리듬게임 곡·채보·AI 제시어 (명세 §8). */
import { http } from '../http'
import type { AiPromptResponse, Chart, CreateChartRequest, CreateSongRequest, Song } from '../types'

export const contentApi = {
  listSongs: (source?: 'OFFICIAL' | 'USER') => http.get<Song[]>('/songs', { source }),
  uploadSong: (body: CreateSongRequest) => http.post<Song>('/songs', body),
  listCharts: (songId: number) => http.get<Chart[]>(`/songs/${songId}/charts`),
  createChart: (body: CreateChartRequest) => http.post<Chart>('/charts', body),
  aiPrompts: () => http.post<AiPromptResponse>('/ai/prompts'),
}
