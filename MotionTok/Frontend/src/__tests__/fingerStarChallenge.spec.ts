import { describe, it, expect } from 'vitest'
import {
  StarSequence,
  mulberry32,
  averageScore,
  isBetterRecord,
} from '../features/games/finger-star/challenge'
import { CONSTELLATIONS } from '../features/games/finger-star/constellations'

const byKey = new Map(CONSTELLATIONS.map((c) => [c.key, c]))
const poolSize = CONSTELLATIONS.length

describe('mulberry32', () => {
  it('같은 시드면 같은 수열을 만든다 (전원 동일 출제 순서의 전제)', () => {
    const a = mulberry32(1234)
    const b = mulberry32(1234)
    for (let i = 0; i < 20; i++) expect(a()).toBe(b())
  })

  it('다른 시드면 수열이 달라진다', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 8 }, () => a())
    const seqB = Array.from({ length: 8 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })
})

describe('StarSequence', () => {
  it('처음 3개는 쉬움·보통에서만 출제된다', () => {
    for (let seed = 0; seed < 20; seed++) {
      const seq = new StarSequence(CONSTELLATIONS, mulberry32(seed))
      for (let i = 0; i < 3; i++) {
        const difficulty = byKey.get(seq.next())?.difficulty
        expect(difficulty, `seed ${seed} draw ${i}`).not.toBe('HARD')
      }
    }
  })

  it('풀이 소진되기 전까지 같은 별자리가 반복되지 않는다', () => {
    const seq = new StarSequence(CONSTELLATIONS, mulberry32(7))
    const drawn = Array.from({ length: poolSize }, () => seq.next())
    expect(new Set(drawn).size).toBe(poolSize)
  })

  it('풀 소진 후 재셔플되어도 직전 별자리가 연속으로 나오지 않는다', () => {
    const seq = new StarSequence(CONSTELLATIONS, mulberry32(42))
    const draws = Array.from({ length: poolSize * 3 }, () => seq.next())
    for (let i = 1; i < draws.length; i++) {
      expect(draws[i], `연속 추첨 ${i - 1}→${i}`).not.toBe(draws[i - 1])
    }
  })

  it('같은 시드면 전체 순서가 동일하다 (멀티 공정성)', () => {
    const a = new StarSequence(CONSTELLATIONS, mulberry32(99))
    const b = new StarSequence(CONSTELLATIONS, mulberry32(99))
    for (let i = 0; i < poolSize * 2; i++) expect(a.next()).toBe(b.next())
  })
})

describe('매치 기록', () => {
  it('평균은 완성 개수로 나눠 반올림하고, 0개면 0점이다', () => {
    expect(averageScore({ count: 3, sum: 250 })).toBe(83)
    expect(averageScore({ count: 0, sum: 0 })).toBe(0)
  })

  it('기록 비교는 완성 개수 우선, 같으면 총점(=평균)으로 가른다', () => {
    expect(isBetterRecord({ count: 3, sum: 100 }, { count: 2, sum: 200 })).toBe(true)
    expect(isBetterRecord({ count: 2, sum: 150 }, { count: 2, sum: 140 })).toBe(true)
    expect(isBetterRecord({ count: 2, sum: 140 }, { count: 2, sum: 140 })).toBe(false)
    expect(isBetterRecord({ count: 1, sum: 999 }, { count: 2, sum: 10 })).toBe(false)
  })
})
