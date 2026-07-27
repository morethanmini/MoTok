import { describe, it, expect } from 'vitest'
import {
  CatchLogic,
  noteProgress,
  isInReach,
  trailPointAt,
  approachOf,
  type Hands,
  type HandState,
} from '../logic/catchLogic'
import { NOTE_RADIUS, HAND_RADIUS, CATCH_REACH_SCALE, SWIPE_REACH_SCALE } from '../core/config'
import type { CatchNote } from '../core/beatmap'

const bm = (notes: CatchNote[]) => ({ approachTimeMs: 1200, notes })
const NO_HANDS: Hands = { left: null, right: null }
const note = (over: Partial<CatchNote> = {}): CatchNote => ({
  timeMs: 2000,
  x: 0.4,
  y: 0.2,
  hand: 'any',
  kind: 'catch',
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

  it('히트 반경은 노트 종류별 배율을 탄다', () => {
    const base = NOTE_RADIUS + HAND_RADIUS
    const at = (x: number) => ({ x, y: 0, grabbed: true })

    const grab = note({ x: 0, y: 0 })
    expect(isInReach(at(base * CATCH_REACH_SCALE - 0.01), grab)).toBe(true)
    expect(isInReach(at(base * CATCH_REACH_SCALE + 0.01), grab)).toBe(false)
    expect(isInReach(null, grab)).toBe(false)

    // 관대함 순서: 연결 > 스와이프 > 주먹
    const swipeNote = note({ x: 0, y: 0, kind: 'swipe' })
    const trailNote = note({ x: 0, y: 0, kind: 'trail' })
    const outsideGrab = at(base * CATCH_REACH_SCALE + 0.02)
    expect(isInReach(outsideGrab, swipeNote)).toBe(true)
    expect(isInReach(at(base * SWIPE_REACH_SCALE + 0.02), swipeNote)).toBe(false)
    expect(isInReach(at(base * SWIPE_REACH_SCALE + 0.02), trailNote)).toBe(true)
  })

  it('노트별 접근 시간이 있으면 그것을 쓴다 (주먹은 더 일찍 등장)', () => {
    const plain = note({ timeMs: 2000 })
    const early = note({ timeMs: 2000, approachMs: 2000 })
    expect(approachOf(plain, 1200)).toBe(1200)
    expect(approachOf(early, 1200)).toBe(2000)
    // 판정 시각은 둘 다 같다
    expect(noteProgress(plain, 2000, 1200)).toBeCloseTo(1)
    expect(noteProgress(early, 2000, 1200)).toBeCloseTo(1)
    // 다른 건 등장 시점 — 주먹 노트가 800ms 먼저 화면에 뜬다(준비 시간)
    expect(noteProgress(plain, 800, 1200)).toBeCloseTo(0)
    expect(noteProgress(early, 0, 1200)).toBeCloseTo(0)
  })

  it('주먹 노트는 다른 노트보다 일찍 스폰된다', () => {
    const logic = new CatchLogic(
      bm([note({ timeMs: 3000, approachMs: 2000 }), note({ timeMs: 3000, kind: 'swipe' })]),
    )
    // 주먹은 t=1000(3000-2000)에, 스와이프는 t=1800(3000-1200)에 등장
    expect(logic.update(1000, NO_HANDS).map((e) => e.type)).toEqual(['spawn'])
    expect(logic.update(1500, NO_HANDS)).toEqual([])
    expect(logic.update(1800, NO_HANDS).map((e) => e.type)).toEqual(['spawn'])
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

  it('이른 grab도 판정창 안이면 인정 → Good (주먹은 창이 1.75배 넓다)', () => {
    const logic = new CatchLogic(bm([note()]))
    // PERFECT ±140 / GOOD ±280 — 200ms 이르면 GOOD
    const events = logic.update(1800, { left: null, right: grabbing() })
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
      [2700, at(false)], // 노트2 Miss 확정(주먹 창 ±280)
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

  it('손이 안 오면 판정창을 지나 Miss', () => {
    const logic = new CatchLogic(bm([note()]))
    const events = runFrames(logic, [
      [2000, NO_HANDS],
      [2300, NO_HANDS],
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

  it('kind가 빠진 노트는 안전하게 catch로 취급한다 (공짜 히트 방지)', () => {
    const bare = { timeMs: 2000, x: 0.4, y: 0.2, hand: 'any' } as unknown as CatchNote
    const logic = new CatchLogic(bm([bare]))
    const open = logic.update(2000, { left: null, right: grabbing({ grabbed: false }) })
    expect(open.filter((e) => e.type === 'hit')).toHaveLength(0)
  })
})

describe('스와이프 판정 — 손이 지나가기만 해도 인정', () => {
  const swipe = (over: Partial<CatchNote> = {}) => note({ kind: 'swipe', ...over })
  const passing = (over: Partial<HandState> = {}): HandState => ({
    x: 0.4,
    y: 0.2,
    grabbed: false,
    ...over,
  })

  it('주먹을 안 쥐어도 반경 안이면 히트', () => {
    const logic = new CatchLogic(bm([swipe()]))
    const events = logic.update(2000, { left: null, right: passing() })
    const hits = events.filter((e) => e.type === 'hit')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ judgement: 'perfect' })
  })

  it('판정창 밖이면 손이 있어도 안 잡힌다', () => {
    const logic = new CatchLogic(bm([swipe()]))
    expect(
      logic.update(1700, { left: null, right: passing() }).filter((e) => e.type === 'hit'),
    ).toHaveLength(0)
  })

  it('캐치보다 넉넉한 반경을 가진다', () => {
    const far = passing({ x: 0.4 + (NOTE_RADIUS + HAND_RADIUS) * 1.15 })
    // 같은 위치에서 catch는 놓치고 swipe는 잡힌다
    const catchLogic = new CatchLogic(bm([note()]))
    expect(
      catchLogic
        .update(2000, { left: null, right: { ...far, grabbed: true } })
        .filter((e) => e.type === 'hit'),
    ).toHaveLength(0)

    const swipeLogic = new CatchLogic(bm([swipe()]))
    expect(
      swipeLogic.update(2000, { left: null, right: far }).filter((e) => e.type === 'hit'),
    ).toHaveLength(1)
  })

  it('멀리 있으면 스와이프도 안 잡힌다', () => {
    const logic = new CatchLogic(bm([swipe()]))
    const events = logic.update(2000, { left: null, right: passing({ x: -0.9 }) })
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(0)
  })
})

describe('연결(trail) 노트 — 경로를 따라 그린다', () => {
  const trail = (over: Partial<CatchNote> = {}): CatchNote =>
    note({
      kind: 'trail',
      x: 0,
      y: 0,
      durationMs: 600,
      path: [{ x: 1.2, y: 0 }],
      ...over,
    })
  const at = (x: number, y = 0): Hands => ({ left: null, right: { x, y, grabbed: false } })

  it('경로 위 기대 위치를 등속으로 계산한다', () => {
    const n = trail()
    expect(trailPointAt(n, 0)).toEqual({ x: 0, y: 0 })
    expect(trailPointAt(n, 0.5).x).toBeCloseTo(0.6)
    expect(trailPointAt(n, 1).x).toBeCloseTo(1.2)
    // 범위를 벗어난 비율은 끝점으로 고정
    expect(trailPointAt(n, 2).x).toBeCloseTo(1.2)
  })

  it('경로를 잘 따라가면 PERFECT', () => {
    const logic = new CatchLogic(bm([trail()]))
    logic.update(2000, at(0)) // 헤드 잡기 → tracing 시작
    const events = []
    for (let t = 2000; t <= 2600; t += 50) {
      const ratio = (t - 2000) / 600
      events.push(...logic.update(t, at(ratio * 1.2)))
    }
    const hits = events.filter((e) => e.type === 'hit')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ judgement: 'perfect' })
    expect(hits[0]!.type === 'hit' && hits[0]!.coverage).toBeGreaterThan(0.65)
  })

  it('헤드만 잡고 안 따라가면 MISS', () => {
    const logic = new CatchLogic(bm([trail()]))
    logic.update(2000, at(0))
    const events = []
    for (let t = 2050; t <= 2600; t += 50) events.push(...logic.update(t, at(0))) // 제자리
    expect(events.filter((e) => e.type === 'miss')).toHaveLength(1)
  })

  it('대부분 따라가다 막판에 놓치면 GOOD', () => {
    const logic = new CatchLogic(bm([trail()]))
    logic.update(2000, at(0))
    const events = []
    for (let t = 2000; t <= 2600; t += 50) {
      const ratio = (t - 2000) / 600
      // 3/4 지점까지 따라가다 이탈
      events.push(...logic.update(t, ratio < 0.75 ? at(ratio * 1.2) : at(-0.9)))
    }
    const hit = events.find((e) => e.type === 'hit')
    expect(hit).toMatchObject({ judgement: 'good' })
  })

  it('앞부분만 따라가는 건 인정 안 된다 — 인식 반경 안은 공짜 구간이라 채점에서 뺀다', () => {
    const logic = new CatchLogic(bm([trail()]))
    logic.update(2000, at(0))
    const events = []
    for (let t = 2000; t <= 2600; t += 50) {
      const ratio = (t - 2000) / 600
      events.push(...logic.update(t, ratio < 0.5 ? at(ratio * 1.2) : at(-0.9)))
    }
    expect(events.filter((e) => e.type === 'miss')).toHaveLength(1)
  })

  it('헤드를 아예 못 잡으면 일반 노트처럼 MISS', () => {
    const logic = new CatchLogic(bm([trail()]))
    const events = runFrames(logic, [
      [2000, NO_HANDS],
      [2161, NO_HANDS],
    ])
    expect(events.filter((e) => e.type === 'miss')).toHaveLength(1)
  })

  it('주먹을 안 쥐어도 헤드가 잡힌다 (swipe와 같은 요건)', () => {
    const logic = new CatchLogic(bm([trail()]))
    logic.update(2000, at(0))
    // tracing으로 넘어갔다면 활성 노트로 남아 있다
    expect(logic.activeNotes()).toHaveLength(1)
    expect(logic.isFinished()).toBe(false)
  })
})

describe('catchUp — 늦게 시작한 참가자 보정', () => {
  const at = (t: number): [number, Hands] => [t, NO_HANDS]

  it('이미 지난 노트를 이벤트 없이 정리한다', () => {
    const notes = [note({ timeMs: 1000 }), note({ timeMs: 2000 }), note({ timeMs: 9000 })]
    const logic = new CatchLogic(bm(notes))

    // 로딩이 늦어 t=5000에 시작 — 앞의 두 개는 이미 지났다
    const skipped = logic.catchUp(5000)
    expect(skipped).toBe(2)

    // 정리된 노트는 이후 update에서 이벤트를 내지 않는다(연출 폭주 방지)
    const events = runFrames(logic, [at(5000), at(5100)])
    expect(events.filter((e) => e.type === 'miss')).toHaveLength(0)
    expect(logic.isFinished()).toBe(false) // 남은 노트는 그대로 살아 있다
  })

  it('아직 안 지난 노트는 건드리지 않는다', () => {
    const logic = new CatchLogic(bm([note({ timeMs: 9000 })]))
    expect(logic.catchUp(5000)).toBe(0)
    // 정상적으로 판정된다
    const hits = logic.update(9000, { left: null, right: { x: 0.4, y: 0.2, grabbed: true } })
    expect(hits.filter((e) => e.type === 'hit')).toHaveLength(1)
  })

  it('제때 시작하면 아무것도 정리하지 않는다', () => {
    const logic = new CatchLogic(bm([note({ timeMs: 1000 }), note({ timeMs: 2000 })]))
    expect(logic.catchUp(0)).toBe(0)
  })
})
