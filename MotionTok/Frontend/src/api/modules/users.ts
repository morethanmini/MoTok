/** 회원 API (명세 §2). */
import { http } from '../http'
import type {
  DecorationConfig,
  GameRecord,
  InventoryItem,
  PointHistoryPage,
  PublicUserProfile,
  UserProfile,
  WithdrawRequest,
} from '../types'

export const usersApi = {
  getMe: () => http.get<UserProfile>('/users/me'),
  /** 랭킹 등에서 다른 사용자의 공개 프로필 조회. 탈퇴·정지 계정은 404 (-96) */
  getProfile: (userId: number) => http.get<PublicUserProfile>(`/users/${userId}`),
  updateProfile: (nickname: string) => http.patch<UserProfile>('/users/me', { nickname }),
  /** 탈퇴 — 본인 확인 값 필수(자체 가입은 비밀번호, 소셜 전용은 소셜 재인증) (-111) */
  withdraw: (proof: WithdrawRequest) => http.delete<void>('/users/me', proof),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.patch<void>('/users/me/password', { currentPassword, newPassword }),
  /**
   * 프로필 사진 확정. 업로드가 끝난 뒤 그 오브젝트 key를 알려 준다.
   * URL이 아니라 key를 보내는 이유 — 서버가 소유권을 확인하고 공개 URL을 직접 계산한다.
   * key에 null을 주면 아바타를 해제한다(기본 이모지).
   */
  updateAvatar: (key: string | null) => http.patch<UserProfile>('/users/me/avatar', { key }),
  /**
   * 기본 프로필 아이콘 선택. 업로드가 없으므로 S3를 거치지 않는다 —
   * preset은 파일명(예: '4_cat')이고 서버가 정적 경로를 붙여 저장한다.
   */
  setAvatarPreset: (preset: string) => http.patch<UserProfile>('/users/me/avatar', { preset }),

  getPoints: () => http.get<{ pointBalance: number }>('/users/me/points'),
  getPointHistory: (page = 0, size = 20) =>
    http.get<PointHistoryPage>('/users/me/points/history', { page, size }),

  getInventory: () => http.get<InventoryItem[]>('/users/me/inventory'),
  setEquipped: (itemId: number, equipped: boolean) =>
    http.patch<InventoryItem>(`/users/me/inventory/${itemId}`, { equipped }),

  getDecoration: () => http.get<DecorationConfig>('/users/me/decoration'),
  saveDecoration: (config: DecorationConfig) =>
    http.put<DecorationConfig>('/users/me/decoration', config),

  /**
   * ⚠️ 서버 미구현 — 명세에는 있으나 백엔드에 라우트가 없다(2026-07 기준).
   * 마이페이지 전적은 게임별 리더보드의 myRank(-96)를 모아서 만든다(MyPageView 참고).
   */
  getRecords: () => http.get<GameRecord[]>('/users/me/records'),
}
