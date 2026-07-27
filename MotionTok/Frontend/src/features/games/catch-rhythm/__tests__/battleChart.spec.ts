import { describe, it, expect } from 'vitest'
import { generateBattleChart, type GeneratedNote } from '../generator/battleChart'
import {
  PRESETS,
  DIFFICULTIES,
  SLOT_MS,
  LEAD_IN_MS,
  X_RANGE,
  Y_RANGE,
  OVERLAP_WINDOW_MS,
  type Difficulty,
} from '../generator/presets'
import { HAND_MAX_SPEED, NOTE_RADIUS } from '../core/config'
import { parseBeatmap } from '../core/beatmap'

const ROUND_MS = 60_000
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

const allNotes = (d: Difficulty, seeds = SEEDS) =>
  seeds.flatMap((s) => generateBattleChart(s, d, ROUND_MS).notes)

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

  it('고정 seed 스냅샷 — 생성기를 바꾸면 여기서 깨진다(의도된 회귀 감지)', () => {
    const chart = generateBattleChart(20260727, 'NORMAL', 12_000)
    const digest = chart.notes.map(
      (n) =>
        `${n.timeMs}:${n.hand}:${n.kind}:${n.x.toFixed(4)}:${n.y.toFixed(4)}:${n.cross ? 'X' : '-'}`,
    )
    expect(digest).toMatchSnapshot()
  })
})

describe('★ 물리적 도달 가능성 — 실플레이에서 "못 치는 패턴"이 나오지 않아야 한다', () => {
  it.each(DIFFICULTIES)('%s: 같은 손 연속 노트가 손 최대 속도 안에 있다', (difficulty) => {
    for (const seed of SEEDS) {
      const chart = generateBattleChart(seed, difficulty, ROUND_MS)
      const last: Record<string, GeneratedNote | undefined> = {}
      for (const n of chart.notes) {
        const prev = last[n.owner]
        if (prev) {
          const dtSec = (n.timeMs - prev.timeMs) / 1000
          const dist = Math.hypot(n.x - prev.x, n.y - prev.y)
          // 여유 계수(REACH_SAFETY)를 감안해도 한계를 넘으면 안 된다
          expect(dist).toBeLessThanOrEqual(HAND_MAX_SPEED * dtSec + 1e-9)
        }
        last[n.owner] = n
      }
    }
  })

  it.each(DIFFICULTIES)('%s: 같은 손 최소 간격을 지킨다', (difficulty) => {
    const minGap = PRESETS[difficulty].minSameHandGapMs
    for (const seed of SEEDS) {
      const chart = generateBattleChart(seed, difficulty, ROUND_MS)
      const last: Record<string, number | undefined> = {}
      for (const n of chart.notes) {
        const prev = last[n.owner]
        if (prev !== undefined) expect(n.timeMs - prev).toBeGreaterThanOrEqual(minGap)
        last[n.owner] = n.timeMs
      }
    }
  })

  it.each(DIFFICULTIES)('%s: 크로스 노트는 충분한 여유가 있을 때만 나온다', (difficulty) => {
    const { crossMinGapMs } = PRESETS[difficulty]
    for (const seed of SEEDS) {
      const chart = generateBattleChart(seed, difficulty, ROUND_MS)
      const last: Record<string, number | undefined> = {}
      for (const n of chart.notes) {
        const prev = last[n.owner]
        if (n.cross && prev !== undefined) {
          expect(n.timeMs - prev).toBeGreaterThanOrEqual(crossMinGapMs)
        }
        last[n.owner] = n.timeMs
      }
    }
  })
})

describe('스키마 적합성', () => {
  it.each(DIFFICULTIES)('%s 출력이 parseBeatmap을 통과한다', (difficulty) => {
    const chart = generateBattleChart(7, difficulty, ROUND_MS)
    const parsed = parseBeatmap(JSON.parse(JSON.stringify(chart)))
    expect(parsed.notes).toHaveLength(chart.notes.length)
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

  it('카운트다운 유예(3초) 안에는 노트가 없고, 라운드를 넘지도 않는다', () => {
    for (const difficulty of DIFFICULTIES) {
      const times = generateBattleChart(3, difficulty, ROUND_MS).notes.map((n) => n.timeMs)
      expect(Math.min(...times)).toBeGreaterThanOrEqual(LEAD_IN_MS)
      expect(Math.max(...times)).toBeLessThanOrEqual(ROUND_MS)
    }
  })

  it('유예보다 짧은 라운드는 빈 채보 — 던지지 않는다', () => {
    const chart = generateBattleChart(5, 'HARD', 1000)
    expect(chart.notes).toEqual([])
    expect(chart.durationMs).toBe(0)
  })
})

describe('노트 다양성', () => {
  it.each(DIFFICULTIES)('%s: 아무 손(any) 노트가 프리셋 비율 ±6%%p 안', (difficulty) => {
    const notes = allNotes(difficulty)
    const ratio = notes.filter((n) => n.hand === 'any').length / notes.length
    expect(ratio).toBeGreaterThanOrEqual(PRESETS[difficulty].anyRate - 0.06)
    expect(ratio).toBeLessThanOrEqual(PRESETS[difficulty].anyRate + 0.06)
  })

  it.each(DIFFICULTIES)('%s: 노트 종류 분포가 프리셋 가중치 ±6%%p 안', (difficulty) => {
    const notes = allNotes(difficulty)
    const w = PRESETS[difficulty].kinds
    const total = w.swipe + w.trail + w.catch
    for (const kind of ['swipe', 'trail', 'catch'] as const) {
      const ratio = notes.filter((n) => n.kind === kind).length / notes.length
      expect(ratio).toBeGreaterThanOrEqual(w[kind] / total - 0.06)
      expect(ratio).toBeLessThanOrEqual(w[kind] / total + 0.06)
    }
  })

  it('★ 스와이프가 주력이다 — 주먹(catch)은 특수 노트로만 나온다', () => {
    for (const difficulty of DIFFICULTIES) {
      const notes = allNotes(difficulty)
      const swipe = notes.filter((n) => n.kind === 'swipe').length / notes.length
      const grab = notes.filter((n) => n.kind === 'catch').length / notes.length
      expect(swipe).toBeGreaterThan(0.55)
      expect(grab).toBeLessThan(0.2)
    }
  })

  it('★ 양손 인식(any)이 기본이다', () => {
    for (const difficulty of DIFFICULTIES) {
      const notes = allNotes(difficulty)
      const any = notes.filter((n) => n.hand === 'any').length / notes.length
      expect(any).toBeGreaterThan(0.4)
    }
  })

  it('세 종류가 모두 나온다', () => {
    for (const difficulty of DIFFICULTIES) {
      const kinds = new Set(allNotes(difficulty).map((n) => n.kind))
      expect(kinds).toEqual(new Set(['swipe', 'trail', 'catch']))
    }
  })

  it('연결 노트는 경로와 길이를 갖고, 경로가 손 속도 안에서 훑을 수 있다', () => {
    for (const difficulty of DIFFICULTIES) {
      const trails = allNotes(difficulty).filter((n) => n.kind === 'trail')
      expect(trails.length).toBeGreaterThan(0)
      for (const n of trails) {
        expect(n.path?.length).toBeGreaterThan(0)
        expect(n.durationMs).toBeGreaterThan(0)
        const pts = [{ x: n.x, y: n.y }, ...(n.path ?? [])]
        let total = 0
        for (let i = 1; i < pts.length; i++) {
          total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
        }
        // 경로 전체를 지속 시간 안에 훑을 수 있어야 한다
        expect(total).toBeLessThanOrEqual(HAND_MAX_SPEED * ((n.durationMs ?? 0) / 1000) + 1e-9)
      }
    }
  })

  it('EASY는 크로스도 동시 노트도 없다', () => {
    const chart = generateBattleChart(77, 'EASY', ROUND_MS)
    expect(chart.notes.some((n) => n.cross)).toBe(false)
    const byTime = new Map<number, number>()
    for (const n of chart.notes) byTime.set(n.timeMs, (byTime.get(n.timeMs) ?? 0) + 1)
    expect([...byTime.values()].every((c) => c === 1)).toBe(true)
  })

  it('동시 노트는 좌우 손에 하나씩 배정된다(owner 기준)', () => {
    const chart = generateBattleChart(31, 'HARD', ROUND_MS)
    const byTime = new Map<number, GeneratedNote[]>()
    for (const n of chart.notes) byTime.set(n.timeMs, [...(byTime.get(n.timeMs) ?? []), n])
    const doubles = [...byTime.values()].filter((g) => g.length > 1)
    expect(doubles.length).toBeGreaterThan(0)
    for (const group of doubles) {
      expect(group).toHaveLength(2)
      expect(group.map((n) => n.owner).sort()).toEqual(['left', 'right'])
    }
  })
})

describe('난이도 곡선', () => {
  it('난이도가 올라갈수록 노트가 많아진다', () => {
    const avg = (d: Difficulty) => allNotes(d).length / SEEDS.length
    expect(avg('EASY')).toBeLessThan(avg('NORMAL'))
    expect(avg('NORMAL')).toBeLessThan(avg('HARD'))
  })

  it('HARD도 초당 2.2개를 넘지 않는다 (실플레이 상한)', () => {
    const playableSec = (ROUND_MS - LEAD_IN_MS) / 1000
    const perSec = allNotes('HARD').length / SEEDS.length / playableSec
    expect(perSec).toBeLessThan(2.2)
  })

  it('EASY는 초당 1개 미만이라 여유가 있다', () => {
    const playableSec = (ROUND_MS - LEAD_IN_MS) / 1000
    const perSec = allNotes('EASY').length / SEEDS.length / playableSec
    expect(perSec).toBeLessThan(1.0)
  })
})

describe('★ 겹침 회피 — 화면에 같이 뜬 노트가 서로를 가리면 못 친다', () => {
  /** 두 노트(경로 포함)의 가장 가까운 점 사이 거리 */
  function closest(a: GeneratedNote, b: GeneratedNote): number {
    const A = [{ x: a.x, y: a.y }, ...(a.path ?? [])]
    const B = [{ x: b.x, y: b.y }, ...(b.path ?? [])]
    let min = Infinity
    for (const p of A) for (const q of B) min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y))
    return min
  }

  it.each(DIFFICULTIES)('%s: 동시에 떠 있는 노트의 시각적 겹침이 8%% 미만', (difficulty) => {
    let pairs = 0
    let overlapped = 0
    for (const seed of SEEDS) {
      const notes = generateBattleChart(seed, difficulty, ROUND_MS).notes
      for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
          const a = notes[i]!
          const b = notes[j]!
          if (b.timeMs - (a.timeMs + (a.durationMs ?? 0)) >= OVERLAP_WINDOW_MS) break
          pairs++
          // 중심 거리가 노트 지름보다 짧으면 화면에서 겹쳐 보인다
          if (closest(a, b) < NOTE_RADIUS * 2) overlapped++
        }
      }
    }
    expect(pairs).toBeGreaterThan(100)
    expect(overlapped / pairs).toBeLessThan(0.1)
  })

  /**
   * 노트 **본체끼리** 겹치는 건 곧바로 "못 치는 패턴"이 된다 — 여기가 진짜 기준선.
   * (연결 노트의 경로가 다른 노트 옆을 스치는 건 리본이라 체감이 다르므로 위 지표에서만 본다)
   */
  it.each(DIFFICULTIES)('%s: 거의 동시(400ms)에 뜨는 노트 본체는 겹치지 않는다', (difficulty) => {
    let pairs = 0
    let overlapped = 0
    for (const seed of SEEDS) {
      const notes = generateBattleChart(seed, difficulty, ROUND_MS).notes
      for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
          const a = notes[i]!
          const b = notes[j]!
          if (b.timeMs - (a.timeMs + (a.durationMs ?? 0)) >= 400) break
          pairs++
          if (Math.hypot(a.x - b.x, a.y - b.y) < NOTE_RADIUS * 2) overlapped++
        }
      }
    }
    expect(pairs).toBeGreaterThan(50)
    expect(overlapped / pairs).toBeLessThan(0.03)
  })
})

describe('배치 불변식', () => {
  it('노트는 항상 스폰 영역 안에 있다 (도달 보정 후에도)', () => {
    const [lo] = X_RANGE.left
    const [, hi] = X_RANGE.right
    for (const difficulty of DIFFICULTIES) {
      for (const n of allNotes(difficulty, [13, 17, 23])) {
        expect(n.x).toBeGreaterThanOrEqual(lo)
        expect(n.x).toBeLessThanOrEqual(hi)
        expect(n.y).toBeGreaterThanOrEqual(Y_RANGE[0])
        expect(n.y).toBeLessThanOrEqual(Y_RANGE[1])
      }
    }
  })
})
