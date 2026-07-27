/**
 * 캐치캐치리듬 임계값 상수 — 튜닝은 이 파일과 generator/presets.ts에서만 한다.
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

// ── 판정 반경 ──────────────────────────────────────────────
/**
 * 실플레이 결론: 손 트래킹이 흔들려서 인식이 빡빡하면 게임이 안 된다.
 * 전반적으로 후하게 잡는다 — 어려움은 채보 밀도로 만들지 판정 반경으로 만들지 않는다.
 */
export const NOTE_RADIUS = 0.15 // 노트 판정 반지름 (게임 좌표)
export const HAND_RADIUS = 0.11 // 손 커서 판정 반지름
/** 스와이프는 스치듯 지나가므로 더 넉넉하게 */
export const SWIPE_REACH_SCALE = 1.6
/** 연결 노트는 경로를 따라가는 중 흔들림이 크므로 가장 넉넉하게 */
export const TRAIL_REACH_SCALE = 1.9

// ── 연결(trail) 노트 ───────────────────────────────────────
/** 경로를 이 비율 이상 따라가면 PERFECT */
export const TRAIL_PERFECT_COVERAGE = 0.65
/** 이 비율 이상이면 GOOD, 미만이면 MISS */
export const TRAIL_GOOD_COVERAGE = 0.35

// ── 제스처 ─────────────────────────────────────────────────
export const FIST_RATIO = 1.1 // TIP-손목 평균 < MCP-손목 평균 × 1.1
export const FIST_CONFIRM_FRAMES = 3 // 상태 전환 확정에 필요한 연속 프레임

// ── 물리적 도달 가능성 ─────────────────────────────────────
/**
 * 손이 편하게 낼 수 있는 이동 속도(게임 좌표 단위/초). 1단위 = 화면 높이의 절반.
 * 채보 생성기가 "직전 노트에서 여기까지 제시간에 갈 수 있는가"를 이 값으로 판정한다.
 * 실플레이에서 손이 못 따라가면 이 값을 낮춘다.
 */
export const HAND_MAX_SPEED = 2.2
/** 도달 한계까지 꽉 채우면 항상 전력질주가 되므로 여유를 둔다 */
export const REACH_SAFETY = 0.85

// ── 비트맵 기본값 ──────────────────────────────────────────
export const DEFAULT_APPROACH_TIME_MS = 1200

// ── 게임 흐름 ──────────────────────────────────────────────
export const COUNTDOWN_SECONDS = 3
export const HAND_LOST_OVERLAY_MS = 2000 // 손 미검출 안내 오버레이까지의 시간
