/**
 * 점수/콤보/통계 — 순수 로직.
 * Perfect 100, Good 50. 콤보 10마다 배율 +0.1 (최대 2.0).
 *
 * 점수는 0~100으로 정규화하지 않는다 — 리듬게임 원점수 그대로 간다.
 * (90초 HARD 이론 최대 ≈ 144,000. 서버 클램프 상한도 같은 값)
 */

import {
  SCORE_PERFECT,
  SCORE_GOOD,
  COMBO_MULT_STEP,
  COMBO_MULT_INC,
  COMBO_MULT_MAX,
} from './config'
import type { Judgement } from './types'

const BASE_SCORE: Record<Judgement, number> = {
  perfect: SCORE_PERFECT,
  good: SCORE_GOOD,
  miss: 0,
}

export function comboMultiplier(combo: number): number {
  return Math.min(1 + Math.floor(combo / COMBO_MULT_STEP) * COMBO_MULT_INC, COMBO_MULT_MAX)
}

export interface ScoreSnapshot {
  score: number
  combo: number
  judgement: Judgement
}

export interface ScoreResult {
  score: number
  maxCombo: number
  counts: Record<Judgement, number>
}

export class ScoreTracker {
  score = 0
  combo = 0
  maxCombo = 0
  counts: Record<Judgement, number> = { perfect: 0, good: 0, miss: 0 }

  /** 판정마다 호출된다. HUD 갱신·SFX 트리거용. */
  constructor(private readonly onChange?: (snapshot: ScoreSnapshot) => void) {}

  add(judgement: Judgement): void {
    this.counts[judgement] += 1
    if (judgement === 'miss') {
      this.combo = 0
    } else {
      this.combo += 1
      this.maxCombo = Math.max(this.maxCombo, this.combo)
      // 배율은 이번 히트로 올라간 콤보 기준 — 콤보 10에 도달하는 히트부터 1.1배
      this.score += Math.round(BASE_SCORE[judgement] * comboMultiplier(this.combo))
    }
    this.onChange?.({ score: this.score, combo: this.combo, judgement })
  }

  result(): ScoreResult {
    return { score: this.score, maxCombo: this.maxCombo, counts: { ...this.counts } }
  }
}
