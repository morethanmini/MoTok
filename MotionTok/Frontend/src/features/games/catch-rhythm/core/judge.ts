/**
 * 타이밍 창 판정 — 순수 함수.
 * deltaMs = 현재 게임 시각 - 노트의 timeMs (음수 = 이른 히트, 양수 = 늦은 히트).
 */

import { PERFECT_WINDOW_MS, GOOD_WINDOW_MS, MISS_AFTER_MS } from './config'
import type { HitJudgement } from './types'

/** 히트 시도에 대한 판정 등급. 창 밖이면 null (히트로 취급하지 않음). */
export function judgeHit(deltaMs: number): HitJudgement | null {
  const abs = Math.abs(deltaMs)
  if (abs <= PERFECT_WINDOW_MS) return 'perfect'
  if (abs <= GOOD_WINDOW_MS) return 'good'
  return null
}

/** 판정 지점 통과 후 MISS_AFTER_MS 초과 → 더 이상 히트 불가, Miss 확정. */
export function isMissed(deltaMs: number): boolean {
  return deltaMs > MISS_AFTER_MS
}

/** 아직 판정창에 진입하기 전인가 (너무 이른 시도 무시용). */
export function isTooEarly(deltaMs: number): boolean {
  return deltaMs < -GOOD_WINDOW_MS
}
