import { describe, it, expect } from 'vitest'
import { generateBattleChart, type GeneratedNote } from '../generator/battleChart'
import {
  PRESETS,
  DIFFICULTIES,
  SLOT_MS,
  LEAD_IN_MS,
  MIN_GAP,
  X_RANGE,
  Y_RANGE,
  type Difficulty,
} from '../generator/presets'
import { parseBeatmap } from '../core/beatmap'

const ROUND_MS = 90_000

describe('결정성 — 전원 동일 채보의 전제', () => {
  it('같은 seed·난이도·길이 → 완전히 같은 채보', () => {
    const a = generateBattleChart(123456789, 'HARD', ROUND_MS)
    const b = generateBattleChart(123456789, 'HARD', ROUND_MS)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('서버 seed가 Long이라 문자열로 와도 같은 결과 (정밀도 손실 방어)', () => {
    const asNumber = generateBattleChart(987654321, 'NORMAL', ROUND_MS)
    const asString = generateBattleChart('987654321', 'NORMAL', ROUND_MS)
    expect(JSON.stringify(asString)).toBe(JSON.stringify(asNumber))
  })

  it('2^53을 넘는 seed 문자열도 처리한다', () => {
    const chart = generateBattleChart('9223372036854775807', 'HARD', ROUND_MS)
    expect(chart.notes.length).toBeGreaterThan(0)
    expect(chart.notes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true)
  })

  it('다른 seed → 다른 채보', () => {
    const a = generateBattleChart(1, 'HARD', ROUND_MS)
    const b = generateBattleChart(2, 'HARD', ROUND_MS)
    expect(JSON.stringify(a.notes)).not.toBe(JSON.stringify(b.notes))
  })

  it('난이도가 다르면 다른 채보', () => {
    const easy = generateBattleChart(42, 'EASY', ROUND_MS)
    const hard = generateBattleChart(42, 'HARD', ROUND_MS)
    expect(easy.notes.length).not.toBe(hard.notes.length)
  })

  it('고정 seed 스냅샷 — 생성기를 바꾸면 여기서 깨진다(의도된 회귀 감지)', () => {
    const chart = generateBattleChart(20260727, 'NORMAL', 10_000)
    const digest = chart.notes.map(
      (n) => `${n.timeMs}:${n.hand}:${n.x.toFixed(4)}:${n.y.toFixed(4)}:${n.cross ? 'X' : '-'}`,
    )
    expect(digest).toMatchSnapshot()
  })
})

describe('스키마 적합성', () => {
  it.each(DIFFICULTIES)('%s 출력이 parseBeatmap을 통과한다', (difficulty) => {
    const chart = generateBattleChart(7, difficulty, ROUND_MS)
    const parsed = parseBeatmap(JSON.parse(JSON.stringify(chart)))
    expect(parsed.notes).toHaveLength(chart.notes.length)
    expect(parsed.mode).toBe('catch')
    expect(parsed.approachTimeMs).toBe(PRESETS[difficulty].approachTimeMs)
  })

  it('노트는 timeMs 오름차순이고 슬롯 격자 위에 놓인다', () => {
    const chart = generateBattleChart(11, 'HARD', ROUND_MS)
    let prev = -1
    for (const n of chart.notes) {
      expect(n.timeMs).toBeGreaterThanOrEqual(prev)
      expect((n.timeMs - LEAD_IN_MS) % SLOT_MS).toBe(0)
      prev = n.timeMs
    }
  })

  it('카운트다운 유예(3초) 안에는 노트가 없다', () => {
    for (const difficulty of DIFFICULTIES) {
      const chart = generateBattleChart(3, difficulty, ROUND_MS)
      expect(Math.min(...chart.notes.map((n) => n.timeMs))).toBeGreaterThanOrEqual(LEAD_IN_MS)
    }
  })

  it('라운드 길이를 넘는 노트가 없다', () => {
    const chart = generateBattleChart(5, 'HARD', ROUND_MS)
    expect(Math.max(...chart.notes.map((n) => n.timeMs))).toBeLessThanOrEqual(ROUND_MS)
  })

  it('durationMs는 마지막 노트 시각', () => {
    const chart = generateBattleChart(5, 'HARD', ROUND_MS)
    expect(chart.durationMs).toBe(chart.notes[chart.notes.length - 1]?.timeMs)
  })

  it('유예보다 짧은 라운드는 빈 채보 — 던지지 않는다', () => {
    const chart = generateBattleChart(5, 'HARD', 1000)
    expect(chart.notes).toEqual([])
    expect(chart.durationMs).toBe(0)
  })
})

describe('난이도 프리셋 반영', () => {
  const slots = Math.floor((ROUND_MS - LEAD_IN_MS) / SLOT_MS) + 1

  it.each(DIFFICULTIES)('%s 노트 수가 density 기대 범위 안', (difficulty) => {
    const preset = PRESETS[difficulty]
    // 동시 노트는 한 슬롯에서 2개가 나온다
    const expected = slots * preset.density * (1 + preset.simultaneous)
    const counts = Array.from(
      { length: 20 },
      (_, i) => generateBattleChart(i + 1, difficulty, ROUND_MS).notes.length,
    )
    const avg = counts.reduce((s, c) => s + c, 0) / counts.length
    expect(avg).toBeGreaterThan(expected * 0.9)
    expect(avg).toBeLessThan(expected * 1.1)
  })

  it('난이도가 올라갈수록 노트가 많아진다', () => {
    const count = (d: Difficulty) => generateBattleChart(99, d, ROUND_MS).notes.length
    expect(count('EASY')).toBeLessThan(count('NORMAL'))
    expect(count('NORMAL')).toBeLessThan(count('HARD'))
  })

  it.each(DIFFICULTIES)('%s 크로스 비율이 프리셋 ±5%%p 안', (difficulty) => {
    const all: GeneratedNote[] = Array.from(
      { length: 20 },
      (_, i) => generateBattleChart(i + 1, difficulty, ROUND_MS).notes,
    ).flat()
    const ratio = all.filter((n) => n.cross).length / all.length
    expect(ratio).toBeGreaterThanOrEqual(PRESETS[difficulty].crossRate - 0.05)
    expect(ratio).toBeLessThanOrEqual(PRESETS[difficulty].crossRate + 0.05)
  })

  it('EASY는 크로스도 동시 노트도 없다', () => {
    const chart = generateBattleChart(77, 'EASY', ROUND_MS)
    expect(chart.notes.some((n) => n.cross)).toBe(false)
    const byTime = new Map<number, number>()
    for (const n of chart.notes) byTime.set(n.timeMs, (byTime.get(n.timeMs) ?? 0) + 1)
    expect([...byTime.values()].every((c) => c === 1)).toBe(true)
  })

  it('동시 노트는 좌우 손에 하나씩 배정된다', () => {
    const chart = generateBattleChart(31, 'HARD', ROUND_MS)
    const byTime = new Map<number, GeneratedNote[]>()
    for (const n of chart.notes) byTime.set(n.timeMs, [...(byTime.get(n.timeMs) ?? []), n])
    const doubles = [...byTime.values()].filter((g) => g.length > 1)
    expect(doubles.length).toBeGreaterThan(0)
    for (const group of doubles) {
      expect(group).toHaveLength(2)
      expect(group.map((n) => n.hand).sort()).toEqual(['left', 'right'])
    }
  })
})

describe('배치 불변식', () => {
  it('크로스가 아니면 자기 손 영역, 크로스면 반대편 영역에 놓인다', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const n of generateBattleChart(13, difficulty, ROUND_MS).notes) {
        const side = n.cross ? (n.hand === 'left' ? 'right' : 'left') : n.hand
        const [lo, hi] = X_RANGE[side]
        expect(n.x).toBeGreaterThanOrEqual(lo)
        expect(n.x).toBeLessThanOrEqual(hi)
        expect(n.y).toBeGreaterThanOrEqual(Y_RANGE[0])
        expect(n.y).toBeLessThanOrEqual(Y_RANGE[1])
      }
    }
  })

  it('연속된 같은 손 노트는 대부분 MIN_GAP 이상 떨어져 있다', () => {
    const chart = generateBattleChart(17, 'HARD', ROUND_MS)
    const last: Record<string, GeneratedNote | undefined> = {}
    let pairs = 0
    let tooClose = 0
    for (const n of chart.notes) {
      const prev = last[n.hand]
      if (prev) {
        pairs++
        if (Math.hypot(n.x - prev.x, n.y - prev.y) < MIN_GAP) tooClose++
      }
      last[n.hand] = n
    }
    expect(pairs).toBeGreaterThan(0)
    // 재샘플 상한(10회)을 넘긴 경우만 붙는다 — 극히 드물어야 한다
    expect(tooClose / pairs).toBeLessThan(0.02)
  })

  it('동시 노트 두 개도 서로 겹치지 않는다', () => {
    const chart = generateBattleChart(23, 'HARD', ROUND_MS)
    const byTime = new Map<number, GeneratedNote[]>()
    for (const n of chart.notes) byTime.set(n.timeMs, [...(byTime.get(n.timeMs) ?? []), n])
    let tooClose = 0
    let doubles = 0
    for (const group of byTime.values()) {
      if (group.length !== 2) continue
      doubles++
      const [a, b] = group as [GeneratedNote, GeneratedNote]
      if (Math.hypot(a.x - b.x, a.y - b.y) < MIN_GAP) tooClose++
    }
    expect(doubles).toBeGreaterThan(0)
    expect(tooClose / doubles).toBeLessThan(0.02)
  })
})
