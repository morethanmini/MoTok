/**
 * 게임④ 연속 모드 벽 스케줄 (S15P11A706-9).
 *
 * <p>벽 i의 출발 시각과 접근 시간을 <b>시간만으로</b> 정한다. 이전에는 "앞 벽이 z로 1.8만큼
 * 멀어지면 다음 벽을 띄운다"였는데, z를 매 프레임 폴링해서 판단하므로 프레임 드랍이 그대로
 * 스폰 지연이 되고, 그 지연이 뒤 벽에 누적된다. 혼자 놀 때는 티가 안 나지만 방에서 같은
 * 벽으로 승부를 가르려면 클라이언트마다 순서가 어긋나선 안 된다.</p>
 *
 * <p>거리 기준을 시간 기준으로 바꾸는 환산이 {@link chainGapRatio}다 — 접근 곡선
 * easeIn(t)=t^2.5의 역함수라 "예전과 같은 간격"이 정확히 재현된다(도착 간격 2.9→2.4초 실측 일치).</p>
 *
 * <p><b>서버(GameSessionService)의 chain endAt 계산과 동기화 필수.</b> 상수 셋과
 * {@link chainDurationMs}가 양쪽에 같은 값으로 있어야 서버가 정한 종료 시각에 마지막 벽이 닿는다.</p>
 */

/** 첫 벽의 접근 시간 = 난이도 기본값 × 이 비율 */
export const CHAIN_START_RATIO = 0.8
/** 벽마다 접근 시간을 이 비율로 곱한다(누적) — 갈수록 빨라진다 */
export const CHAIN_SPEEDUP = 0.95
/** 아무리 빨라져도 이 아래로는 안 내린다 — 포즈를 바꿔 잡을 물리적 최소 시간 */
export const CHAIN_MIN_MS = 2200
/** 앞 벽이 출발선에서 이만큼(월드 단위) 멀어지면 다음 벽이 출발한다 */
export const CHAIN_SPAWN_GAP_Z = 1.8
/** 접근 곡선 easeIn의 지수 — BodyFitGame.easeIn과 같은 값 */
const EASE_POW = 2.5

/**
 * 스폰 간격을 "접근 시간의 몇 배"로 환산한 비율.
 * easeIn(t)=t^2.5가 gap/span이 되는 t — 즉 앞 벽이 gap만큼 가는 데 쓰는 시간의 비율이다.
 */
export function chainGapRatio(spanZ: number): number {
  return (CHAIN_SPAWN_GAP_Z / spanZ) ** (1 / EASE_POW)
}

/**
 * 서버가 내려준 시드 문자열 → 결정론 난수 생성기(mulberry32).
 *
 * <p>방에서 벽 수열을 맞추는 방법이 이것뿐이다 — 벽마다 서버가 포즈를 보내면 30장이면 30번을
 * 왕복해야 하고 지연이 그대로 벽 위치로 나타난다. 시드 하나만 받고 각자 같은 수열을 재생한다.</p>
 *
 * <p>mulberry32를 고른 이유는 32비트 정수 연산 네 줄이면 끝나고(라이브러리 없음) 주기가
 * 2^32라 벽 30장 × 난수 8개에 한참 남기 때문이다. 암호학적 용도가 아니다.</p>
 */
export function seededRng(seed: string): () => number {
  // 문자열 → 32비트 해시(FNV 계열). 서버 시드는 십진수 문자열이지만 무엇이 와도 받는다
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 벽 i의 접근 시간 — i가 커질수록 빨라지고 CHAIN_MIN_MS에서 멈춘다 */
export function chainApproachMs(index: number, baseApproachMs: number): number {
  return Math.max(CHAIN_MIN_MS, baseApproachMs * CHAIN_START_RATIO * CHAIN_SPEEDUP ** index)
}

/** 벽 i가 출발한 뒤 벽 i+1이 출발할 때까지의 간격 */
export function chainGapMs(index: number, baseApproachMs: number, spanZ: number): number {
  return chainApproachMs(index, baseApproachMs) * chainGapRatio(spanZ)
}

/**
 * 첫 벽 출발부터 마지막 벽 도착까지 걸리는 시간 — 서버 endAt의 근거.
 * walls가 0 이하면 0(무한 모드는 종료 시각이 없다 — 솔로 전용).
 */
export function chainDurationMs(baseApproachMs: number, walls: number, spanZ: number): number {
  if (walls <= 0) return 0
  let elapsed = 0
  for (let i = 0; i < walls - 1; i++) elapsed += chainGapMs(i, baseApproachMs, spanZ)
  return elapsed + chainApproachMs(walls - 1, baseApproachMs)
}
