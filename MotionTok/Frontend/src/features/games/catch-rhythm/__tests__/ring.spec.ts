import { describe, it, expect } from 'vitest'
import {
  RingLogic,
  laneAngleDeg,
  laneDirection,
  bearingDeg,
  angleDiffDeg,
  isInHitZone,
  isInHoldZone,
  holdBearingDeg,
  ringNotePosition,
  type RingNote,
} from '../ring/ringLogic'
import {
  LANE_COUNT,
  RING_RADIUS,
  HIT_ZONE_ANGLE_DEG,
  HIT_ZONE_INNER_TOL,
  CAMP_TIMEOUT_MS,
  RING_HAND_SPEED,
} from '../ring/ringConfig'
import { generateRingChart, RING_PRESETS } from '../ring/ringChart'
import { DIFFICULTIES, LEAD_IN_MS, SLOT_MS } from '../generator/presets'
import type { Hands } from '../logic/catchLogic'

const ROUND_MS = 60_000
const SEEDS = Array.from({ length: 15 }, (_, i) => i + 1)
const NO_HANDS: Hands = { left: null, right: null }

/** 레인 중심에 정확히 놓인 손 */
function atLane(lane: number, radius = RING_RADIUS) {
  const d = laneDirection(lane)
  return { x: d.x * radius, y: d.y * radius, grabbed: false }
}
const rightAt = (lane: number, radius = RING_RADIUS): Hands => ({
  left: null,
  right: atLane(lane, radius),
})

const tap = (over: Partial<RingNote> = {}): RingNote => ({
  timeMs: 2000,
  lane: 0,
  hand: 'any',
  type: 'tap',
  ...over,
})
const bm = (notes: RingNote[]) => ({ approachTimeMs: 1200, notes })

describe('링 기하', () => {
  it('레인 0은 12시, 시계방향 45° 간격', () => {
    expect(laneAngleDeg(0)).toBe(0)
    expect(laneAngleDeg(2)).toBe(90)
    expect(laneAngleDeg(4)).toBe(180)
    const up = laneDirection(0)
    expect(up.x).toBeCloseTo(0)
    expect(up.y).toBeCloseTo(1) // 위가 +y
    const right = laneDirection(2)
    expect(right.x).toBeCloseTo(1)
    expect(right.y).toBeCloseTo(0)
  })

  it('방위각과 각도 차', () => {
    expect(bearingDeg(0, 1)).toBeCloseTo(0)
    expect(bearingDeg(1, 0)).toBeCloseTo(90)
    expect(bearingDeg(0, 0)).toBeNull()
    expect(angleDiffDeg(350, 10)).toBe(20) // 0도를 넘어가도 최소 차
  })

  it('노트는 중심에서 링으로 밀려 나온다', () => {
    const n = tap({ timeMs: 2000, lane: 0 })
    // 스폰 시점 = 중심
    expect(Math.hypot(...Object.values(ringNotePosition(n, 800, 1200)))).toBeCloseTo(0)
    // 도달 시점 = 링 반지름
    const at = ringNotePosition(n, 2000, 1200)
    expect(Math.hypot(at.x, at.y)).toBeCloseTo(RING_RADIUS)
  })
})

describe('히트 존', () => {
  it('레인 중심·링 반지름이면 존 안', () => {
    expect(isInHitZone(atLane(3), 3)).toBe(true)
  })

  it('★ 안쪽으로 들어오면 존 밖, 바깥으로 뻗는 건 계속 인정', () => {
    // 중심 쪽으로 너무 들어오면 레인을 벗어난 것
    expect(isInHitZone(atLane(3, RING_RADIUS - HIT_ZONE_INNER_TOL - 0.05), 3)).toBe(false)
    expect(isInHitZone(atLane(3, RING_RADIUS - HIT_ZONE_INNER_TOL + 0.05), 3)).toBe(true)
    // 바깥으로는 아무리 뻗어도 빠지지 않는다 — 오버슈트는 실수가 아니다
    expect(isInHitZone(atLane(3, RING_RADIUS + 0.5), 3)).toBe(true)
    expect(isInHitZone(atLane(3, RING_RADIUS + 1.5), 3)).toBe(true)
  })

  it('각도 허용 범위 경계', () => {
    const inside = (deg: number) => {
      const rad = (deg * Math.PI) / 180
      return { x: Math.sin(rad) * RING_RADIUS, y: Math.cos(rad) * RING_RADIUS }
    }
    expect(isInHitZone(inside(HIT_ZONE_ANGLE_DEG - 1), 0)).toBe(true)
    expect(isInHitZone(inside(HIT_ZONE_ANGLE_DEG + 1), 0)).toBe(false)
  })

  it('손이 없으면 존 밖', () => {
    expect(isInHitZone(null, 0)).toBe(false)
  })
})

describe('탭 판정', () => {
  it('도달 순간 존 안이면 PERFECT', () => {
    const logic = new RingLogic(bm([tap()]))
    logic.update(1900, rightAt(0)) // 미리 대기 — 아직 판정 안 함
    const events = logic.update(2000, rightAt(0))
    const hits = events.filter((e) => e.type === 'hit')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ judgement: 'perfect' })
  })

  it('미리 와서 기다려도 손해 보지 않는다 (도달 전 판정 안 함)', () => {
    const logic = new RingLogic(bm([tap()]))
    // 300ms 전부터 존에 있어도 도달 순간에 PERFECT
    const early = logic.update(1700, rightAt(0))
    expect(early.filter((e) => e.type === 'hit')).toHaveLength(0)
    const onTime = logic.update(2000, rightAt(0))
    expect(onTime.filter((e) => e.type === 'hit')[0]).toMatchObject({ judgement: 'perfect' })
  })

  it('늦게 진입하면 GOOD', () => {
    const logic = new RingLogic(bm([tap()]))
    logic.update(2000, NO_HANDS)
    const events = logic.update(2100, rightAt(0))
    expect(events.filter((e) => e.type === 'hit')[0]).toMatchObject({ judgement: 'good' })
  })

  it('다른 레인에 있으면 안 잡힌다', () => {
    const logic = new RingLogic(bm([tap({ lane: 0 })]))
    const events = logic.update(2000, rightAt(4)) // 정반대
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(0)
  })

  it('손이 안 오면 Miss', () => {
    const logic = new RingLogic(bm([tap()]))
    logic.update(2000, NO_HANDS)
    const events = logic.update(2200, NO_HANDS)
    expect(events.filter((e) => e.type === 'miss')).toHaveLength(1)
    expect(logic.isFinished()).toBe(true)
  })

  it('★ 캠핑 방지 — 존에 계속 얹어두면 무효, 나갔다 와야 재활성', () => {
    const logic = new RingLogic(bm([tap({ timeMs: 5000 })]))
    // 존에 오래 머문다
    for (let t = 0; t <= CAMP_TIMEOUT_MS + 500; t += 250) logic.update(t, rightAt(0))
    expect(logic.isCamping('right', 0, CAMP_TIMEOUT_MS + 500)).toBe(true)

    // 그대로 도달해도 안 잡힌다
    const camped = logic.update(5000, rightAt(0))
    expect(camped.filter((e) => e.type === 'hit')).toHaveLength(0)

    // 존을 벗어났다 재진입하면 다시 유효
    logic.update(5010, NO_HANDS)
    const revived = logic.update(5020, rightAt(0))
    expect(revived.filter((e) => e.type === 'hit')).toHaveLength(1)
  })

  it('한 손은 한 프레임에 노트 하나만 처리한다', () => {
    const logic = new RingLogic(bm([tap({ timeMs: 2000 }), tap({ timeMs: 2000 })]))
    const events = logic.update(2000, rightAt(0))
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(1)
  })
})

describe('홀드·슬라이드', () => {
  const hold = (over: Partial<RingNote> = {}): RingNote =>
    tap({ type: 'hold', durationMs: 600, laneDelta: 0, ...over })

  it('제자리 홀드를 끝까지 유지하면 히트', () => {
    const logic = new RingLogic(bm([hold()]))
    logic.update(2000, rightAt(0)) // head 잡기
    const events = []
    for (let t = 2050; t <= 2650; t += 50) events.push(...logic.update(t, rightAt(0)))
    const hits = events.filter((e) => e.type === 'hit')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ judgement: 'perfect' })
  })

  it('슬라이드는 이동하는 존을 따라가야 한다', () => {
    // 2레인(90°) 시계방향 슬라이드
    const logic = new RingLogic(bm([hold({ laneDelta: 2 })]))
    logic.update(2000, rightAt(0))
    const events = []
    for (let t = 2050; t <= 2650; t += 50) {
      // 요구 방위각을 정확히 따라간다
      const deg = holdBearingDeg(hold({ laneDelta: 2 }), t)
      const rad = (deg * Math.PI) / 180
      events.push(
        ...logic.update(t, {
          left: null,
          right: {
            x: Math.sin(rad) * RING_RADIUS,
            y: Math.cos(rad) * RING_RADIUS,
            grabbed: false,
          },
        }),
      )
    }
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(1)
  })

  it('슬라이드를 안 따라가고 제자리에 있으면 실패', () => {
    const logic = new RingLogic(bm([hold({ laneDelta: 4 })])) // 반 바퀴
    logic.update(2000, rightAt(0))
    const events = []
    for (let t = 2050; t <= 2650; t += 50) events.push(...logic.update(t, rightAt(0)))
    expect(events.filter((e) => e.type === 'miss')).toHaveLength(1)
  })

  it('홀드 존 판정은 이동 각도를 따른다', () => {
    const n = hold({ laneDelta: 2 })
    expect(holdBearingDeg(n, 2000)).toBeCloseTo(0) // 시작
    expect(holdBearingDeg(n, 2300)).toBeCloseTo(45) // 절반 = 1레인
    expect(holdBearingDeg(n, 2600)).toBeCloseTo(90) // 끝 = 2레인
    expect(isInHoldZone(atLane(0), n, 2000)).toBe(true)
    expect(isInHoldZone(atLane(0), n, 2600)).toBe(false) // 안 따라가면 벗어난다
  })
})

describe('링 채보 생성기', () => {
  it('같은 seed면 완전히 같은 채보', () => {
    const a = generateRingChart(1234, 'HARD', ROUND_MS)
    const b = generateRingChart(1234, 'HARD', ROUND_MS)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('문자열 seed도 같은 결과 (Long 정밀도 방어)', () => {
    expect(JSON.stringify(generateRingChart('777', 'NORMAL', ROUND_MS))).toBe(
      JSON.stringify(generateRingChart(777, 'NORMAL', ROUND_MS)),
    )
  })

  it('노트는 유효한 레인·시각에 놓인다', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const n of generateRingChart(9, difficulty, ROUND_MS).notes) {
        expect(n.lane).toBeGreaterThanOrEqual(0)
        expect(n.lane).toBeLessThan(LANE_COUNT)
        expect(n.timeMs).toBeGreaterThanOrEqual(LEAD_IN_MS)
        expect((n.timeMs - LEAD_IN_MS) % SLOT_MS).toBe(0)
      }
    }
  })

  it('★ 같은 손 연속 노트가 링 둘레 이동 속도 안에 있다', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const seed of SEEDS) {
        const chart = generateRingChart(seed, difficulty, ROUND_MS)
        const last: Record<string, { lane: number; endMs: number } | undefined> = {}
        for (const n of chart.notes) {
          const prev = last[n.owner]
          if (prev) {
            const laneGap = Math.min(
              Math.abs(n.lane - prev.lane) % LANE_COUNT,
              LANE_COUNT - (Math.abs(n.lane - prev.lane) % LANE_COUNT),
            )
            const arc = RING_RADIUS * laneGap * ((Math.PI * 2) / LANE_COUNT)
            const dtSec = (n.timeMs - prev.endMs) / 1000
            expect(arc).toBeLessThanOrEqual(RING_HAND_SPEED * dtSec + 1e-9)
          }
          const endLane = (((n.lane + (n.laneDelta ?? 0)) % LANE_COUNT) + LANE_COUNT) % LANE_COUNT
          last[n.owner] = { lane: endLane, endMs: n.timeMs + (n.durationMs ?? 0) }
        }
      }
    }
  })

  it('같은 손 최소 간격을 지킨다', () => {
    for (const difficulty of DIFFICULTIES) {
      const minGap = RING_PRESETS[difficulty].minSameHandGapMs
      for (const seed of SEEDS) {
        const last: Record<string, number | undefined> = {}
        for (const n of generateRingChart(seed, difficulty, ROUND_MS).notes) {
          const prev = last[n.owner]
          if (prev !== undefined) expect(n.timeMs - prev).toBeGreaterThanOrEqual(minGap)
          last[n.owner] = n.timeMs + (n.durationMs ?? 0)
        }
      }
    }
  })

  it('양손 인식(any)이 기본이다', () => {
    for (const difficulty of DIFFICULTIES) {
      const notes = SEEDS.flatMap((s) => generateRingChart(s, difficulty, ROUND_MS).notes)
      const any = notes.filter((n) => n.hand === 'any').length / notes.length
      expect(any).toBeGreaterThan(0.4)
    }
  })

  it('★ 홀드는 현재 생성하지 않는다 (실플레이 피드백으로 제외)', () => {
    for (const difficulty of DIFFICULTIES) {
      const notes = SEEDS.flatMap((s) => generateRingChart(s, difficulty, ROUND_MS).notes)
      expect(notes.every((n) => n.type === 'tap')).toBe(true)
      expect(RING_PRESETS[difficulty].holdRate).toBe(0)
    }
  })

  it('난이도가 올라갈수록 노트가 많아진다', () => {
    const count = (d: (typeof DIFFICULTIES)[number]) =>
      SEEDS.reduce((s, seed) => s + generateRingChart(seed, d, ROUND_MS).notes.length, 0)
    expect(count('EASY')).toBeLessThan(count('NORMAL'))
    expect(count('NORMAL')).toBeLessThan(count('HARD'))
  })
})
