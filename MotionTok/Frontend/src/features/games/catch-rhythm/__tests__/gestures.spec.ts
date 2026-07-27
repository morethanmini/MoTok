import { describe, it, expect } from 'vitest'
import { isFist, StableState, type Landmark } from '../logic/gestures'
import { FIST_CONFIRM_FRAMES } from '../core/config'

/**
 * 합성 랜드마크: 손목(0)은 (0.5, 0.9), MCP(5,9,13,17)는 손목에서 mcpDist,
 * TIP(8,12,16,20)은 tipDist 떨어진 위치. 나머지는 손목 위치로 채운다.
 */
const FINGER_DIRS = [-0.3, -0.1, 0.1, 0.3] // 손가락별로 약간 다른 방향

function mkHand({ tipDist, mcpDist }: { tipDist: number; mcpDist: number }): Landmark[] {
  const wrist = { x: 0.5, y: 0.9 }
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ ...wrist }))
  const place = (indices: number[], d: number) => {
    indices.forEach((idx, i) => {
      const dir = FINGER_DIRS[i] ?? 0
      lm[idx] = { x: wrist.x + Math.sin(dir) * d, y: wrist.y - Math.cos(dir) * d }
    })
  }
  place([5, 9, 13, 17], mcpDist)
  place([8, 12, 16, 20], tipDist)
  return lm
}

describe('isFist (TIP-손목 평균 < MCP-손목 평균 × 1.1)', () => {
  it('편 손 (TIP이 MCP보다 멀다) → false', () => {
    expect(isFist(mkHand({ tipDist: 0.3, mcpDist: 0.15 }))).toBe(false)
  })

  it('주먹 (TIP이 MCP 근처로 말림) → true', () => {
    expect(isFist(mkHand({ tipDist: 0.12, mcpDist: 0.15 }))).toBe(true)
  })

  it('경계: TIP 평균 = MCP × 1.1 근처', () => {
    expect(isFist(mkHand({ tipDist: 0.15 * 1.09, mcpDist: 0.15 }))).toBe(true)
    expect(isFist(mkHand({ tipDist: 0.15 * 1.11, mcpDist: 0.15 }))).toBe(false)
  })

  it('손 크기가 달라도 비율 판정이라 결과가 같다 (카메라 거리 무관)', () => {
    expect(isFist(mkHand({ tipDist: 0.24, mcpDist: 0.3 }))).toBe(true)
    expect(isFist(mkHand({ tipDist: 0.06, mcpDist: 0.075 }))).toBe(true)
  })

  it('랜드마크가 모자라면(트래킹 유실) false', () => {
    expect(isFist([])).toBe(false)
    expect(isFist(mkHand({ tipDist: 0.12, mcpDist: 0.15 }).slice(0, 20))).toBe(false)
  })
})

describe('StableState (연속 프레임 확정)', () => {
  it(`${FIST_CONFIRM_FRAMES}프레임 연속이어야 전환`, () => {
    const s = new StableState(false)
    expect(s.update(true)).toBe(false)
    expect(s.update(true)).toBe(false)
    expect(s.update(true)).toBe(true) // 3번째에 확정
    expect(s.justChanged).toBe(true)
  })

  it('전환 후 유지 프레임에서는 justChanged가 false (쓸고 다니기 방지)', () => {
    const s = new StableState(false)
    s.update(true)
    s.update(true)
    s.update(true)
    expect(s.justChanged).toBe(true)
    s.update(true)
    expect(s.justChanged).toBe(false)
    expect(s.state).toBe(true)
  })

  it('흔들리는 신호(노이즈)는 전환되지 않음', () => {
    const s = new StableState(false)
    s.update(true)
    s.update(false)
    s.update(true)
    s.update(false)
    expect(s.state).toBe(false)
  })

  it('쥠→펴짐 복귀도 같은 프레임 수를 요구한다', () => {
    const s = new StableState(false)
    s.update(true)
    s.update(true)
    s.update(true)
    expect(s.state).toBe(true)
    expect(s.update(false)).toBe(true)
    expect(s.update(false)).toBe(true)
    expect(s.update(false)).toBe(false)
    expect(s.justChanged).toBe(true)
  })
})
