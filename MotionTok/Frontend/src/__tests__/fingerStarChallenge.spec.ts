import { describe, it, expect } from 'vitest'
import {
  ChallengeDeck,
  challengeRoundScore,
  difficultyForRound,
} from '../features/games/finger-star/challenge'
import { CONSTELLATIONS } from '../features/games/finger-star/constellations'

describe('difficultyForRound', () => {
  it('라운드 1~2 EASY, 3~4 NORMAL, 5부터 HARD', () => {
    expect(difficultyForRound(1)).toBe('EASY')
    expect(difficultyForRound(2)).toBe('EASY')
    expect(difficultyForRound(3)).toBe('NORMAL')
    expect(difficultyForRound(4)).toBe('NORMAL')
    expect(difficultyForRound(5)).toBe('HARD')
    expect(difficultyForRound(20)).toBe('HARD')
  })
})

describe('challengeRoundScore', () => {
  it('티어 배수(1.0/1.2/1.5)를 적용해 반올림한다', () => {
    expect(challengeRoundScore(80, 'EASY')).toBe(80)
    expect(challengeRoundScore(80, 'NORMAL')).toBe(96)
    expect(challengeRoundScore(85, 'HARD')).toBe(128)
    expect(challengeRoundScore(0, 'HARD')).toBe(0)
  })
})

describe('ChallengeDeck', () => {
  it('뽑힌 key는 항상 요청한 티어 소속이다', () => {
    const deck = new ChallengeDeck(CONSTELLATIONS)
    for (const tier of ['EASY', 'NORMAL', 'HARD'] as const) {
      const key = deck.next(tier)
      expect(CONSTELLATIONS.find((c) => c.key === key)?.difficulty).toBe(tier)
    }
  })

  it('티어가 소진되기 전까지 같은 별자리가 반복되지 않는다', () => {
    const deck = new ChallengeDeck(CONSTELLATIONS)
    const easyCount = CONSTELLATIONS.filter((c) => c.difficulty === 'EASY').length
    const drawn = Array.from({ length: easyCount }, () => deck.next('EASY'))
    expect(new Set(drawn).size).toBe(easyCount)
  })

  it('소진 후 재셔플되어도 직전 별자리가 연속으로 나오지 않는다', () => {
    // 항상 0을 돌려주는 rng — 셔플 결과가 결정적이라 재셔플 경계를 재현할 수 있다
    const deck = new ChallengeDeck(CONSTELLATIONS, () => 0)
    const hardCount = CONSTELLATIONS.filter((c) => c.difficulty === 'HARD').length
    const draws = Array.from({ length: hardCount * 3 }, () => deck.next('HARD'))
    for (let i = 1; i < draws.length; i++) {
      expect(draws[i], `연속 추첨 ${i - 1}→${i}`).not.toBe(draws[i - 1])
    }
  })
})
