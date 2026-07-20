/**
 * 라우트 이름 상수 — 코드 전반에서 문자열 대신 이것으로 네비게이션하세요.
 * (오타 방지 + 경로 변경 시 단일 지점 수정)
 */
export const RouteName = {
  Start: 'start',
  Auth: 'auth',
  Lobby: 'lobby',
  DeviceSetup: 'device-setup',
  GameRoom: 'game-room',
  GameResult: 'game-result',
} as const

export type RouteName = (typeof RouteName)[keyof typeof RouteName]
