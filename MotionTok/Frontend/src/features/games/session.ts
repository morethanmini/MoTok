/** 게임 컴포넌트에 내려주는 진행 중 세션 정보 (GAME_START 수신으로 구성, 모든 게임 공용). */
export interface ActiveGameSession {
  sessionId: string
  constellationKey: string
  /** 라운드 시작/종료 — 서버 epoch millis (타이머 권위는 서버) */
  startAt: number
  endAt: number
  /** serverNow - Date.now() — 클라이언트 시계 보정값 */
  clockOffset: number
}
