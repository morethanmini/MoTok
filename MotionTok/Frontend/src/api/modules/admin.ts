/** 관리자 API (명세 §10). */
import { http } from '../http'
import type {
  AuditLog,
  CreateSongRequest,
  Game,
  ReportedUser,
  Sanction,
  SanctionRequest,
  Song,
} from '../types'

export const adminApi = {
  reports: () => http.get<ReportedUser[]>('/admin/reports'),
  sanctions: () => http.get<Sanction[]>('/admin/sanctions'),
  applySanction: (body: SanctionRequest) => http.post<Sanction>('/admin/sanctions', body),
  toggleGame: (gameId: number, isActive: boolean) =>
    http.patch<Game>(`/admin/games/${gameId}`, { isActive }),
  registerSong: (body: CreateSongRequest) => http.post<Song>('/admin/songs', body),
  auditLogs: (page = 0) => http.get<AuditLog[]>('/admin/audit-logs', { page }),
}
