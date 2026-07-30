/** 회원 API (명세 §2). */
import { http } from '../http'
import type {
  DecorationConfig,
  GameRecord,
  InventoryItem,
  PointHistoryPage,
  PublicUserProfile,
  UserProfile,
  WarningNotice,
  WithdrawRequest,
} from '../types'

export const usersApi = {
  getMe: () => http.get<UserProfile>('/users/me'),

  /**
   * GET /users/me/warnings — 아직 확인하지 않은 관리자 경고(오래된 것부터).
   *
   * 제재 도메인에서 당사자가 부르는 유일한 조회다 — 정지·영구정지는 접근 자체가 막혀 여기 닿지
   * 못하고 403·소켓 종료가 안내를 대신한다. 경고만 접근을 허용한 채 전달해야 해서 창구가 있다.
   * 개인 큐 푸시는 접속 중이 아니면 폐기되므로 로그인·재연결마다 이걸로 놓친 것을 메운다.
   */
  warnings: () => http.get<WarningNotice[]>('/users/me/warnings'),

  /** POST /users/me/warnings/{id}/ack — 확인 처리. 멱등이라 여러 탭에서 눌러도 안전하다. */
  acknowledgeWarning: (warningId: number) =>
    http.post<void>(`/users/me/warnings/${warningId}/ack`),
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
  /** 다른 사용자의 게임별 전적(-141 친구 상세). 공개 범위는 공개 프로필과 동일(회원 전체) */
  getRecordsOf: (userId: number) => http.get<GameRecord[]>(`/users/${userId}/records`),
}
