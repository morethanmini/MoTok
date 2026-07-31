import { describe, it, expect } from 'vitest'
import { depthFromHands, DEPTH_TOP_SW, DEPTH_BOT_SW } from '../depth'

/**
 * 깊이 제어 스펙 — 양손 높이 → 깊이 0~1 (단면도 전환).
 *
 * 정규화가 핵심이다: 같은 자세는 카메라 거리와 무관하게 같은 깊이여야 한다.
 * 조준이 원시 프레임 좌표를 써서 화면 46%만 덮었던 결함(2026-07-30)의 재발 방지.
 */

const SW = 150
const SHOULDER_Y = 240

describe('depthFromHands', () => {
  it('어깨 높이는 중간 깊이다', () => {
    expect(depthFromHands(SHOULDER_Y, SHOULDER_Y, SW)).toBeCloseTo(0.5)
  })

  it('손을 올리면 얕고 내리면 깊다', () => {
    const up = depthFromHands(SHOULDER_Y - 0.5 * SW, SHOULDER_Y, SW)
    const down = depthFromHands(SHOULDER_Y + 0.5 * SW, SHOULDER_Y, SW)
    expect(up).toBeLessThan(0.5)
    expect(down).toBeGreaterThan(0.5)
  })

  it('조작 범위 끝에서 0과 1에 정확히 닿는다', () => {
    expect(depthFromHands(SHOULDER_Y + DEPTH_TOP_SW * SW, SHOULDER_Y, SW)).toBe(0)
    expect(depthFromHands(SHOULDER_Y + DEPTH_BOT_SW * SW, SHOULDER_Y, SW)).toBe(1)
  })

  it('범위를 벗어나면 0~1로 잘린다', () => {
    expect(depthFromHands(SHOULDER_Y - 3 * SW, SHOULDER_Y, SW)).toBe(0)
    expect(depthFromHands(SHOULDER_Y + 3 * SW, SHOULDER_Y, SW)).toBe(1)
  })

  it('카메라 거리(어깨너비)가 달라도 같은 자세는 같은 깊이다', () => {
    // 어깨너비 배수로 같은 오프셋 — 가까이(sw 200)와 멀리(sw 120)
    const near = depthFromHands(SHOULDER_Y + 0.4 * 200, SHOULDER_Y, 200)
    const far = depthFromHands(SHOULDER_Y + 0.4 * 120, SHOULDER_Y, 120)
    expect(near).toBeCloseTo(far)
  })

  it('어깨너비가 없으면(sw 0) 중간 깊이로 안전하게 빠진다', () => {
    expect(depthFromHands(100, 240, 0)).toBe(0.5)
  })
})
