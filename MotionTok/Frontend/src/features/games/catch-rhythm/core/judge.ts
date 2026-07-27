/**
 * 타이밍 창 판정 — 순수 함수.
 * deltaMs = 현재 게임 시각 - 노트의 timeMs (음수 = 이른 히트, 양수 = 늦은 히트).
 */

import { PERFECT_WINDOW_MS, GOOD_WINDOW_MS, MISS_AFTER_MS } from './config'
import type { HitJudgement } from './types'

/**
 * 히트 시도에 대한 판정 등급. 창 밖이면 null (히트로 취급하지 않음).
 * @param windowScale 노트 종류별 관대함 배율(주먹 노트는 넓게 잡는다)
 */
export function judgeHit(deltaMs: number, windowScale = 1): HitJudgement | null {
  const abs = Math.abs(deltaMs)
  if (abs <= PERFECT_WINDOW_MS * windowScale) return 'perfect'
  if (abs <= GOOD_WINDOW_MS * windowScale) return 'good'
  return null
}

/** 판정 지점 통과 후 MISS_AFTER_MS 초과 → 더 이상 히트 불가, Miss 확정. */
export function isMissed(deltaMs: number, windowScale = 1): boolean {
  return deltaMs > MISS_AFTER_MS * windowScale
}

/**
 * 판정창 안에 얼마나 깊이 들어와 있는가. 0 = 창 밖, 1 = 정확히 판정 시점.
 * "지금 쳐라"를 화면에 보여주는 데 쓴다 — 판정 로직에는 관여하지 않는다.
 */
export function windowCloseness(deltaMs: number, windowScale = 1): number {
  const span = GOOD_WINDOW_MS * windowScale
  return Math.max(0, 1 - Math.abs(deltaMs) / span)
}

/** 아직 판정창에 진입하기 전인가 (너무 이른 시도 무시용). */
export function isTooEarly(deltaMs: number): boolean {
  return deltaMs < -GOOD_WINDOW_MS
}
