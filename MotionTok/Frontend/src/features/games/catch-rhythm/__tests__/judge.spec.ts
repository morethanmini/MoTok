import { describe, it, expect } from 'vitest'
import { judgeHit, isMissed, isTooEarly } from '../core/judge'
import { comboMultiplier, ScoreTracker, type ScoreSnapshot } from '../core/score'
import { GameClock } from '../core/clock'
import { PERFECT_WINDOW_MS, GOOD_WINDOW_MS, MISS_AFTER_MS } from '../core/config'

describe('judgeHit (타이밍 창)', () => {
  it('±80ms 이내는 Perfect', () => {
    expect(judgeHit(0)).toBe('perfect')
    expect(judgeHit(PERFECT_WINDOW_MS)).toBe('perfect')
    expect(judgeHit(-PERFECT_WINDOW_MS)).toBe('perfect')
  })

  it('±80ms 초과 ±160ms 이내는 Good', () => {
    expect(judgeHit(PERFECT_WINDOW_MS + 1)).toBe('good')
    expect(judgeHit(-PERFECT_WINDOW_MS - 1)).toBe('good')
    expect(judgeHit(GOOD_WINDOW_MS)).toBe('good')
    expect(judgeHit(-GOOD_WINDOW_MS)).toBe('good')
  })

  it('±160ms 밖은 히트 아님(null)', () => {
    expect(judgeHit(GOOD_WINDOW_MS + 1)).toBeNull()
    expect(judgeHit(-GOOD_WINDOW_MS - 1)).toBeNull()
  })
})

describe('isMissed / isTooEarly', () => {
  it('판정 지점 통과 후 +160ms 초과 시 Miss', () => {
    expect(isMissed(MISS_AFTER_MS)).toBe(false)
    expect(isMissed(MISS_AFTER_MS + 1)).toBe(true)
    expect(isMissed(-100)).toBe(false)
  })

  it('판정창 진입 전이면 tooEarly', () => {
    expect(isTooEarly(-GOOD_WINDOW_MS - 1)).toBe(true)
    expect(isTooEarly(-GOOD_WINDOW_MS)).toBe(false)
  })
})

describe('점수/콤보', () => {
  it('배율: 콤보 10마다 +0.1, 최대 2.0', () => {
    expect(comboMultiplier(0)).toBe(1.0)
    expect(comboMultiplier(9)).toBe(1.0)
    expect(comboMultiplier(10)).toBeCloseTo(1.1)
    expect(comboMultiplier(55)).toBeCloseTo(1.5)
    expect(comboMultiplier(100)).toBe(2.0)
    expect(comboMultiplier(500)).toBe(2.0)
  })

  it('Perfect 100 / Good 50 기본 점수, Miss는 콤보 리셋', () => {
    const s = new ScoreTracker()
    s.add('perfect')
    expect(s.score).toBe(100)
    expect(s.combo).toBe(1)
    s.add('good')
    expect(s.score).toBe(150)
    s.add('miss')
    expect(s.combo).toBe(0)
    expect(s.maxCombo).toBe(2)
    expect(s.counts).toEqual({ perfect: 1, good: 1, miss: 1 })
  })

  it('콤보 10에 도달하는 히트부터 1.1배', () => {
    const s = new ScoreTracker()
    for (let i = 0; i < 9; i++) s.add('perfect') // 900점, 콤보 9
    expect(s.score).toBe(9 * 100)
    s.add('perfect') // 콤보 10 도달 → 1.1배
    expect(s.score).toBe(900 + 110)
  })

  it('점수를 100으로 정규화하지 않는다 — 원점수 누적', () => {
    const s = new ScoreTracker()
    for (let i = 0; i < 200; i++) s.add('perfect')
    expect(s.score).toBeGreaterThan(30_000)
    expect(s.maxCombo).toBe(200)
  })

  it('onChange 콜백으로 판정마다 스냅샷을 알린다', () => {
    const seen: ScoreSnapshot[] = []
    const s = new ScoreTracker((snap) => seen.push(snap))
    s.add('perfect')
    s.add('miss')
    expect(seen).toEqual([
      { score: 100, combo: 1, judgement: 'perfect' },
      { score: 100, combo: 0, judgement: 'miss' },
    ])
  })

  it('result()는 방어적 복사본을 준다', () => {
    const s = new ScoreTracker()
    s.add('good')
    const r = s.result()
    r.counts.good = 999
    expect(s.counts.good).toBe(1)
  })
})

describe('GameClock', () => {
  it('currentTime 기준 ms 반환', () => {
    const fake = { currentTime: 10.0 }
    const clock = new GameClock(fake)
    expect(clock.now()).toBe(0) // 시작 전
    clock.start()
    fake.currentTime = 10.5
    expect(clock.now()).toBeCloseTo(500)
    fake.currentTime = 72.345
    expect(clock.now()).toBeCloseTo(62345)
  })

  it('예약 시작(atCtxTime) 지원 — 시작 전에는 음수 t (카운트다운)', () => {
    const fake = { currentTime: 5.0 }
    const clock = new GameClock(fake)
    clock.start(8.0) // 3초 뒤 t=0
    expect(clock.now()).toBeCloseTo(-3000)
    fake.currentTime = 8.0
    expect(clock.now()).toBeCloseTo(0)
  })

  it('stop 후에는 0', () => {
    const fake = { currentTime: 1.0 }
    const clock = new GameClock(fake)
    clock.start()
    fake.currentTime = 2.0
    expect(clock.isRunning).toBe(true)
    clock.stop()
    expect(clock.now()).toBe(0)
    expect(clock.isRunning).toBe(false)
  })
})
