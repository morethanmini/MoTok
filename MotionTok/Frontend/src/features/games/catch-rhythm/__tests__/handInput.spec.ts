import { describe, it, expect } from 'vitest'
import { toGameCoords, palmCenter, HandInputTracker, type HandFrame } from '../input/handInput'
import type { Landmark } from '../logic/gestures'

const ASPECT = 16 / 9

/** 손목(0)·MCP(5,17)를 지정 위치에 두고, 나머지는 편 손/주먹에 맞춰 채운다. */
function hand(nx: number, ny: number, fisted: boolean): Landmark[] {
  const wrist = { x: nx, y: ny }
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ ...wrist }))
  const mcpD = 0.15
  const tipD = fisted ? 0.12 : 0.3
  const dirs = [-0.3, -0.1, 0.1, 0.3]
  ;[5, 9, 13, 17].forEach((idx, i) => {
    const d = dirs[i] ?? 0
    lm[idx] = { x: nx + Math.sin(d) * mcpD, y: ny - Math.cos(d) * mcpD }
  })
  ;[8, 12, 16, 20].forEach((idx, i) => {
    const d = dirs[i] ?? 0
    lm[idx] = { x: nx + Math.sin(d) * tipD, y: ny - Math.cos(d) * tipD }
  })
  return lm
}

const frame = (specs: { nx: number; ny: number; fisted: boolean; label: string }[]): HandFrame => ({
  landmarks: specs.map((s) => hand(s.nx, s.ny, s.fisted)),
  handedness: specs.map((s) => s.label),
})

describe('toGameCoords', () => {
  it('화면 중앙이 원점', () => {
    expect(toGameCoords(0.5, 0.5, ASPECT)).toEqual({ x: 0, y: 0 })
  })

  it('셀피 미러링 — 카메라 왼쪽(nx 작음)이 화면 오른쪽(+x)', () => {
    expect(toGameCoords(0, 0.5, ASPECT).x).toBeCloseTo(ASPECT)
    expect(toGameCoords(1, 0.5, ASPECT).x).toBeCloseTo(-ASPECT)
  })

  it('y는 위가 + (정규화는 아래가 +)', () => {
    expect(toGameCoords(0.5, 0, ASPECT).y).toBeCloseTo(1)
    expect(toGameCoords(0.5, 1, ASPECT).y).toBeCloseTo(-1)
  })

  it('x는 종횡비만큼 넓다 — 채보 범위(±0.75)는 항상 화면 안', () => {
    expect(Math.abs(toGameCoords(0, 0.5, ASPECT).x)).toBeGreaterThan(0.75)
    expect(Math.abs(toGameCoords(0, 0.5, 4 / 3).x)).toBeGreaterThan(0.75)
  })
})

describe('palmCenter', () => {
  it('손목·양쪽 MCP의 평균', () => {
    const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }))
    lm[0] = { x: 0.3, y: 0.6 }
    lm[5] = { x: 0.4, y: 0.5 }
    lm[17] = { x: 0.5, y: 0.4 }
    const c = palmCenter(lm)
    expect(c.x).toBeCloseTo(0.4)
    expect(c.y).toBeCloseTo(0.5)
  })

  it('랜드마크가 모자라면 화면 중앙으로 폴백', () => {
    expect(palmCenter([])).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('HandInputTracker', () => {
  it('handedness 라벨대로 좌우를 배정한다', () => {
    const t = new HandInputTracker()
    const hands = t.update(
      frame([
        { nx: 0.7, ny: 0.5, fisted: false, label: 'Left' },
        { nx: 0.3, ny: 0.5, fisted: false, label: 'Right' },
      ]),
      ASPECT,
    )
    expect(hands.left).not.toBeNull()
    expect(hands.right).not.toBeNull()
    // 미러링: nx 0.7(카메라 오른쪽)은 화면 왼쪽(-x)
    expect(hands.left!.x).toBeLessThan(0)
    expect(hands.right!.x).toBeGreaterThan(0)
  })

  it('안 잡힌 손은 null', () => {
    const t = new HandInputTracker()
    const hands = t.update(frame([{ nx: 0.5, ny: 0.5, fisted: false, label: 'Right' }]), ASPECT)
    expect(hands.left).toBeNull()
    expect(hands.right).not.toBeNull()
  })

  it('grabbed는 펴짐→쥠 전환 프레임에만 true', () => {
    const t = new HandInputTracker()
    const open = frame([{ nx: 0.5, ny: 0.5, fisted: false, label: 'Right' }])
    const fist = frame([{ nx: 0.5, ny: 0.5, fisted: true, label: 'Right' }])

    expect(t.update(open, ASPECT).right!.grabbed).toBe(false)
    // 3프레임 연속이어야 확정
    expect(t.update(fist, ASPECT).right!.grabbed).toBe(false)
    expect(t.update(fist, ASPECT).right!.grabbed).toBe(false)
    expect(t.update(fist, ASPECT).right!.grabbed).toBe(true) // 전환 프레임
    expect(t.update(fist, ASPECT).right!.grabbed).toBe(false) // 유지 — 쓸고 다니기 방지
    expect(t.isFisted.right).toBe(true)
  })

  it('손이 사라지면 상태를 새로 시작한다 (유령 전환 방지)', () => {
    const t = new HandInputTracker()
    const fist = frame([{ nx: 0.5, ny: 0.5, fisted: true, label: 'Right' }])
    t.update(fist, ASPECT)
    t.update(fist, ASPECT)
    t.update(frame([]), ASPECT) // 손 소실
    expect(t.isFisted.right).toBe(false)
    // 다시 쥠 — 누적된 2프레임이 사라졌으니 곧바로 전환되지 않는다
    expect(t.update(fist, ASPECT).right!.grabbed).toBe(false)
  })

  it('reset은 양손 상태를 지운다', () => {
    const t = new HandInputTracker()
    const fist = frame([{ nx: 0.5, ny: 0.5, fisted: true, label: 'Right' }])
    for (let i = 0; i < 4; i++) t.update(fist, ASPECT)
    expect(t.isFisted.right).toBe(true)
    t.reset()
    expect(t.isFisted.right).toBe(false)
    expect(t.update(fist, ASPECT).right!.grabbed).toBe(false)
  })
})
