/** 게임 컴포넌트에 내려주는 진행 중 세션 정보 (GAME_START 수신으로 구성, 모든 게임 공용). */
export interface ActiveGameSession {
  sessionId: string
  /** 핑거 스타 별자리 키 — 그림으로 말해요 세션에서는 빈 문자열 */
  constellationKey: string
  /** 라운드 시작/종료 — 서버 epoch millis (타이머 권위는 서버) */
  startAt: number
  endAt: number
  /** serverNow - Date.now() — 클라이언트 시계 보정값 */
  clockOffset: number
  /** ── 그림으로 말해요(게임 10, 명세 v0.2.20) 전용 — 핑거 스타는 null ── */
  topicWord?: string | null
  /** 화가 순서(userId, 서버 셔플). 턴 k: 교대 [startAt+k(h+t)s, +hs) → 그리기 [그 뒤, 다음 턴) */
  turnOrder?: string[] | null
  turnDurationSec?: number | null
  handoverSec?: number | null
}
