/**
 * 핑거 스타 90초 매치 규칙 — 순수 로직 (캔버스/DOM 의존 없음).
 *
 * 매치 = 90초 동안 별자리를 연속으로 완성(각 별자리는 모든 별을 켠 채 3초 유지).
 * 완성 즉시 그 별자리의 점수를 확정하고 다음 별자리로 넘어간다.
 * 승부: 완성 개수(1순위) → 점수 평균(2순위, 개수가 같으면 총점 비교와 동치).
 *
 * 멀티는 서버가 GAME_START에 실어준 공유 시드로 전원이 같은 별자리 순서를 뽑는다
 * (판정은 각자 로컬 — 순서만 공정하게 고정).
 */
import type { Constellation } from './constellations'

/** 시드 고정 PRNG(mulberry32) — 같은 시드면 모든 클라이언트에서 같은 수열. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 매치 동안 별자리를 뽑는 순서 생성기.
 * - 처음 3개: 쉬움(EASY)·보통(NORMAL) 풀에서만 출제
 * - 이후: 전체 풀에서 아직 안 나온 것 우선, 풀 소진 시 재셔플(직전 별자리 연속 방지)
 */
export class StarSequence {
  private readonly allKeys: string[]
  private readonly openers: string[]
  private readonly rng: () => number
  private queue: string[] = []
  private used = new Set<string>()
  private drawn = 0
  private lastKey: string | null = null

  constructor(pool: Constellation[], rng: () => number = Math.random) {
    this.rng = rng
    this.allKeys = pool.map((c) => c.key)
    this.openers = this.shuffled(
      pool.filter((c) => c.difficulty !== 'HARD').map((c) => c.key),
    )
  }

  next(): string {
    let key: string
    if (this.drawn < 3 && this.drawn < this.openers.length) {
      key = this.openers[this.drawn]!
    } else {
      if (this.queue.length === 0) {
        const fresh = this.allKeys.filter((k) => !this.used.has(k))
        if (fresh.length === 0) {
          this.used.clear()
          this.queue = this.shuffled(this.allKeys)
          if (this.queue.length > 1 && this.queue[0] === this.lastKey) {
            ;[this.queue[0], this.queue[1]] = [this.queue[1]!, this.queue[0]!]
          }
        } else {
          this.queue = this.shuffled(fresh)
        }
      }
      key = this.queue.shift()!
    }
    this.used.add(key)
    this.lastKey = key
    this.drawn += 1
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

/** 매치 집계 — 완성 개수와 점수 합. 평균은 표시 시점에 계산한다. */
export interface MatchRecord {
  count: number
  sum: number
}

export function averageScore(record: MatchRecord): number {
  return record.count > 0 ? Math.round(record.sum / record.count) : 0
}

/** 승부 규칙과 동일한 기록 비교 — 완성 개수 우선, 같으면 총점(=평균) 비교. */
export function isBetterRecord(candidate: MatchRecord, current: MatchRecord): boolean {
  if (candidate.count !== current.count) return candidate.count > current.count
  return candidate.sum > current.sum
}
