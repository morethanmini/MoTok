/** 회원 API (명세 §2). */
import { http } from '../http'
import type {
  DecorationConfig,
  GameRecord,
  InventoryItem,
  PointHistoryPage,
  UserProfile,
} from '../types'

export const usersApi = {
  getMe: () => http.get<UserProfile>('/users/me'),
  updateProfile: (nickname: string) => http.patch<UserProfile>('/users/me', { nickname }),
  withdraw: () => http.delete<void>('/users/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.patch<void>('/users/me/password', { currentPassword, newPassword }),

  getPoints: () => http.get<{ pointBalance: number }>('/users/me/points'),
  getPointHistory: (page = 0, size = 20) =>
    http.get<PointHistoryPage>('/users/me/points/history', { page, size }),

  getInventory: () => http.get<InventoryItem[]>('/users/me/inventory'),
  setEquipped: (itemId: number, equipped: boolean) =>
    http.patch<InventoryItem>(`/users/me/inventory/${itemId}`, { equipped }),

  getDecoration: () => http.get<DecorationConfig>('/users/me/decoration'),
  saveDecoration: (config: DecorationConfig) =>
    http.put<DecorationConfig>('/users/me/decoration', config),

  getRecords: () => http.get<GameRecord[]>('/users/me/records'),
}
