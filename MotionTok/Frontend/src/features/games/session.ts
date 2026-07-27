/** 게임 컴포넌트에 내려주는 진행 중 세션 정보 (GAME_START 수신으로 구성, 모든 게임 공용). */
export interface ActiveGameSession {
  sessionId: string
  constellationKey: string
  /** 라운드 시작/종료 — 서버 epoch millis (타이머 권위는 서버) */
  startAt: number
  endAt: number
  /** serverNow - Date.now() — 클라이언트 시계 보정값 */
  clockOffset: number
  /** 게임④(-86): 출제자 userId — 내가 출제자면 출제 페이즈에 포즈를 제출한다 */
  setterUserId?: string | null
  /** 게임④(-86): 난이도(easy/normal/hard) — 벽 접근 시간·구멍 여유 */
  difficulty?: string | null
  /** 게임④ 출제자 로테이션(-48): 1-based 현재 라운드 / 전체 라운드 수 */
  roundNo?: number | null
  totalRounds?: number | null
}
