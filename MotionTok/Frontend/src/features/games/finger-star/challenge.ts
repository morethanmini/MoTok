/**
 * 핑거 스타 솔로 도전 모드(런) 규칙 — 순수 로직 (캔버스/DOM 의존 없음).
 *
 * 런 = 난이도가 점차 오르는 연속 라운드. 라운드를 완성하면 다음 라운드로,
 * 시간 내 미완성이면 런 종료. 총점 = Σ(라운드 점수 × 난이도 배수).
 * 서버 미연동 클라이언트 전용 — 랭킹 반영은 별도(서버 세션 기반, Phase 2).
 */
import type { Constellation, Difficulty } from './constellations'

/** 라운드 → 난이도 커브: 1~2 EASY, 3~4 NORMAL, 5부터 HARD */
export function difficultyForRound(round: number): Difficulty {
  if (round <= 2) return 'EASY'
  if (round <= 4) return 'NORMAL'
  return 'HARD'
}

/** 어려운 별자리를 깰수록 이득이 되도록 하는 티어 배수 */
export const TIER_MULTIPLIER: Record<Difficulty, number> = { EASY: 1, NORMAL: 1.2, HARD: 1.5 }

/** 라운드 획득 점수 = 기본 점수(0~100) × 티어 배수, 반올림 */
export function challengeRoundScore(base: number, difficulty: Difficulty): number {
  return Math.round(base * TIER_MULTIPLIER[difficulty])
}

/**
 * 런 동안 별자리를 뽑는 덱 — 티어별로 셔플해 순서대로 소비하므로
 * 같은 런 안에서는 티어가 소진되기 전까지 중복이 없다.
 * 소진되면 재셔플하되 직전 별자리가 연속으로 나오지 않게 한다.
 */
export class ChallengeDeck {
  private readonly pools: Record<Difficulty, string[]>
  private readonly queues: Record<Difficulty, string[]>
  private readonly rng: () => number
  private lastKey: string | null = null

  constructor(pool: Constellation[], rng: () => number = Math.random) {
    this.rng = rng
    this.pools = { EASY: [], NORMAL: [], HARD: [] }
    for (const c of pool) this.pools[c.difficulty].push(c.key)
    this.queues = {
      EASY: this.shuffled(this.pools.EASY),
      NORMAL: this.shuffled(this.pools.NORMAL),
      HARD: this.shuffled(this.pools.HARD),
    }
  }

  next(difficulty: Difficulty): string {
    const queue = this.queues[difficulty]
    if (queue.length === 0) {
      const refill = this.shuffled(this.pools[difficulty])
      if (refill.length > 1 && refill[0] === this.lastKey) {
        ;[refill[0], refill[1]] = [refill[1]!, refill[0]!]
      }
      queue.push(...refill)
    }
    const key = queue.shift()!
    this.lastKey = key
    return key
  }

  private shuffled(keys: string[]): string[] {
    const arr = [...keys]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
    }
    return arr
  }
}
