/**
 * 캐치캐치리듬 임계값 상수 — 튜닝은 이 파일과 generator/presets.ts에서만 한다.
 * 프로토(docs-personal/motion-party-proto/src/config.js)에서 캐치(그랩) 모드에
 * 필요한 것만 가져왔다. 링·슬래시 상수는 해당 모드를 구현하지 않으므로 제외.
 */

// ── 타이밍 판정 ────────────────────────────────────────────
export const PERFECT_WINDOW_MS = 80 // ±80ms
export const GOOD_WINDOW_MS = 160 // ±160ms
export const MISS_AFTER_MS = 160 // 판정 지점 통과 후 +160ms 초과 시 Miss

// ── 점수/콤보 ──────────────────────────────────────────────
export const SCORE_PERFECT = 100
export const SCORE_GOOD = 50
export const COMBO_MULT_STEP = 10 // 콤보 10마다
export const COMBO_MULT_INC = 0.1 // 배율 +0.1
export const COMBO_MULT_MAX = 2.0 // 최대 2.0

// ── 캐치(그랩) 판정 ────────────────────────────────────────
export const NOTE_RADIUS = 0.12 // 노트 판정 반지름 (게임 좌표)
export const HAND_RADIUS = 0.08 // 손 커서 판정 반지름
export const FIST_RATIO = 1.1 // TIP-손목 평균 < MCP-손목 평균 × 1.1
export const FIST_CONFIRM_FRAMES = 3 // 상태 전환 확정에 필요한 연속 프레임

// ── 비트맵 기본값 ──────────────────────────────────────────
export const DEFAULT_APPROACH_TIME_MS = 1200

// ── 게임 흐름 ──────────────────────────────────────────────
export const COUNTDOWN_SECONDS = 3
export const HAND_LOST_OVERLAY_MS = 2000 // 손 미검출 안내 오버레이까지의 시간
