/**
 * 라우트 이름 상수 — 코드 전반에서 문자열 대신 이것으로 네비게이션하세요.
 * (오타 방지 + 경로 변경 시 단일 지점 수정)
 */
export const RouteName = {
  Start: 'start',
  Auth: 'auth',
  /** 소셜 최초 로그인 후 닉네임을 직접 정하는 화면 (-22) */
  NicknameSetup: 'nickname-setup',
  Lobby: 'lobby',
  DeviceSetup: 'device-setup',
  GameRoom: 'game-room',
  GameResult: 'game-result',
  FindId: 'find-id',
  ResetPassword: 'reset-password',
  MyPage: 'my-page',
  AccountSettings: 'account-settings',
  Shop: 'shop',
  AiItemCreate: 'ai-item-create',
  Inventory: 'inventory',
  Friends: 'friends',
  Ranking: 'ranking',
  GamesCatalog: 'games-catalog',
  Admin: 'admin',
  Unsupported: 'unsupported',
  /** 게임④ 아바타 렌더러 랩 — 개발 전용 (-136) */
  DevAvatarLab: 'dev-avatar-lab',
} as const

export type RouteName = (typeof RouteName)[keyof typeof RouteName]
