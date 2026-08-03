/**
 * 핑거 스타 60초 매치 규칙 — 순수 로직 (캔버스/DOM 의존 없음).
 *
 * 매치 = 60초 동안 별자리를 연속으로 완성(각 별자리는 모든 별을 켠 채 3초 유지).
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
 * 쉬운 별자리로 여는 판 수 — 이만큼 지나면 별 개수·난이도를 가리지 않는다.
 *
 * 손이 풀릴 만큼은 쉽게 가되, 60초 안에 여기까지 오는 사람이 5별만 보고 끝나지는 않을 만큼.
 * 지금 데이터로는 최소 개수(5별)가 7개라 여는 판을 다 채우고도 매번 조합이 달라진다.
 */
const OPENER_COUNT = 4

/**
 * 매치 동안 별자리를 뽑는 순서 생성기.
 * - 처음 {@link OPENER_COUNT}개: 별이 가장 적은 것부터(쉬움·보통 풀 안에서)
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
    // 여는 판은 별이 적은 것부터 — 별 개수가 이 게임의 체감 난이도를 사실상 정한다.
    // 별 하나에 손가락 하나라 8별은 두 손을 다 펴야 하고 5별은 한 손으로도 닿는다.
    // HARD만 빼고 섞던 때는 첫 판에 7별 북두칠성이 나올 수 있어 너무 어렵다는 말을 들었다.
    // 섞은 뒤 개수로 정렬한다 — sort가 안정 정렬이라 같은 개수끼리는 섞인 순서가 남고,
    // 그래서 매번 같은 별자리로 시작하지는 않는다.
    const stars = new Map(pool.map((c) => [c.key, c.pts.length]))
    this.openers = this.shuffled(pool.filter((c) => c.difficulty !== 'HARD').map((c) => c.key))
      .sort((a, b) => stars.get(a)! - stars.get(b)!)
  }

  next(): string {
    let key: string
    if (this.drawn < OPENER_COUNT && this.drawn < this.openers.length) {
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
