import { describe, it, expect } from 'vitest'
import {
  CatchLogic,
  noteProgress,
  isInReach,
  type Hands,
  type HandState,
} from '../logic/catchLogic'
import { NOTE_RADIUS, HAND_RADIUS } from '../core/config'
import type { CatchNote } from '../core/beatmap'

const bm = (notes: CatchNote[]) => ({ approachTimeMs: 1200, notes })
const NO_HANDS: Hands = { left: null, right: null }
const note = (over: Partial<CatchNote> = {}): CatchNote => ({
  timeMs: 2000,
  x: 0.4,
  y: 0.2,
  hand: 'any',
  ...over,
})

function runFrames(logic: CatchLogic, frames: [number, Hands][]) {
  return frames.flatMap(([tMs, hands]) => logic.update(tMs, hands))
}

describe('noteProgress / isInReach', () => {
  it('스폰 시 0, 도달 시 1', () => {
    const n = note({ timeMs: 2000 })
    expect(noteProgress(n, 800, 1200)).toBeCloseTo(0)
    expect(noteProgress(n, 2000, 1200)).toBeCloseTo(1)
  })

  it('히트 반경 = NOTE_RADIUS + HAND_RADIUS', () => {
    const n = note({ x: 0, y: 0 })
    const reach = NOTE_RADIUS + HAND_RADIUS
    expect(isInReach({ x: reach - 0.01, y: 0, grabbed: true }, n)).toBe(true)
    expect(isInReach({ x: reach + 0.01, y: 0, grabbed: true }, n)).toBe(false)
    expect(isInReach(null, n)).toBe(false)
  })
})

describe('캐치(그랩) 판정', () => {
  const grabbing = (over: Partial<HandState> = {}): HandState => ({
    x: 0.4,
    y: 0.2,
    grabbed: true,
    ...over,
  })

  it('노트 위에서 전환 이벤트 → 히트 (도달 시각 = Perfect)', () => {
    const logic = new CatchLogic(bm([note()]))
    const events = logic.update(2000, { left: null, right: grabbing() })
    const hits = events.filter((e) => e.type === 'hit')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ judgement: 'perfect', hand: 'right', deltaMs: 0 })
  })

  it('이른 grab(−100ms)도 판정창 안이면 인정 → Good', () => {
    const logic = new CatchLogic(bm([note()]))
    const events = logic.update(1900, { left: null, right: grabbing() })
    const hit = events.find((e) => e.type === 'hit')
    expect(hit).toMatchObject({ judgement: 'good' })
  })

  it('판정창 밖 grab은 무시 (너무 이르면 노트 유지)', () => {
    const logic = new CatchLogic(bm([note()]))
    const events = logic.update(1700, { left: null, right: grabbing() }) // -300ms
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(0)
    expect(logic.isFinished()).toBe(false)
  })

  it('쥔 채로 있으면(전환 없음) 히트 없음 — 전환 순간만 인정', () => {
    // 같은 자리에 노트 2개: 첫 전환으로 1번만 히트, 이후 쥔 상태 유지 → 2번은 Miss
    const logic = new CatchLogic(bm([note({ timeMs: 2000 }), note({ timeMs: 2400 })]))
    const at = (grabbed: boolean): Hands => ({ left: null, right: grabbing({ grabbed }) })
    const events = runFrames(logic, [
      [2000, at(true)], // 전환 → 노트1 히트
      [2100, at(false)], // 쥔 상태 유지(전환 아님)
      [2400, at(false)], // 노트2 도달 — 전환 없음
      [2561, at(false)], // 노트2 Miss 확정
    ])
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'miss')).toHaveLength(1)
  })

  it('한 번의 전환은 노트 하나만 파괴', () => {
    const logic = new CatchLogic(bm([note({ timeMs: 2000 }), note({ timeMs: 2100 })]))
    const events = logic.update(2050, { left: null, right: grabbing() })
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(1)
  })

  it('멀리서 grab → 무시', () => {
    const logic = new CatchLogic(bm([note()]))
    const events = logic.update(2000, { left: null, right: grabbing({ x: -0.5 }) })
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(0)
  })

  it('hand 지정 노트는 지정 손만 인정', () => {
    const logic = new CatchLogic(bm([note({ hand: 'left' })]))
    let events = logic.update(2000, { left: null, right: grabbing() })
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(0)
    events = logic.update(2050, { left: grabbing(), right: null })
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(1)
  })

  it('양손 동시 노트는 각 손이 각각 처리한다', () => {
    const logic = new CatchLogic(
      bm([note({ hand: 'left', x: -0.4 }), note({ hand: 'right', x: 0.4 })]),
    )
    const events = logic.update(2000, {
      left: grabbing({ x: -0.4 }),
      right: grabbing({ x: 0.4 }),
    })
    const hits = events.filter((e) => e.type === 'hit')
    expect(hits).toHaveLength(2)
    expect(hits.map((h) => h.hand).sort()).toEqual(['left', 'right'])
  })

  it('손이 안 오면 +160ms 초과 시 Miss', () => {
    const logic = new CatchLogic(bm([note()]))
    const events = runFrames(logic, [
      [2000, NO_HANDS],
      [2161, NO_HANDS],
    ])
    expect(events.filter((e) => e.type === 'miss')).toHaveLength(1)
    expect(logic.isFinished()).toBe(true)
  })

  it('스폰 이벤트는 timeMs - approachTimeMs에 발생', () => {
    const logic = new CatchLogic(bm([note()]))
    expect(logic.update(799, NO_HANDS)).toEqual([])
    expect(logic.update(800, NO_HANDS).map((e) => e.type)).toEqual(['spawn'])
    expect(logic.activeNotes()).toHaveLength(1)
  })

  it('히트한 노트는 다시 판정되지 않는다', () => {
    const logic = new CatchLogic(bm([note()]))
    logic.update(2000, { left: null, right: grabbing() })
    const later = logic.update(2500, { left: null, right: grabbing() })
    expect(later).toEqual([])
    expect(logic.isFinished()).toBe(true)
  })
})
