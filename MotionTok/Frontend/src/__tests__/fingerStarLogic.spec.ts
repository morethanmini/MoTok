import { describe, it, expect } from 'vitest'
import {
  collectFingerSlots,
  layoutConstellation,
  matchFingersToTargets,
  computeRatioScore,
  partialScore,
  FINGER_TIPS,
  type Point,
} from '../features/games/finger-star/logic'

/** 21개 랜드마크 배열을 만들고 손가락 끝(4,8,12,16,20)만 지정 좌표로 채운다 */
function handLandmarks(tips: [number, number][]): { x: number; y: number }[] {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }))
  tips.forEach(([x, y], i) => {
    lm[FINGER_TIPS[i]!] = { x, y }
  })
  return lm
}

describe('collectFingerSlots', () => {
  it('오른손/왼손 랜드마크를 R1~R5/L1~L5 슬롯으로 매핑한다', () => {
    const slots = collectFingerSlots(
      [handLandmarks([[0.1, 0.2], [0.2, 0.2], [0.3, 0.2], [0.4, 0.2], [0.5, 0.2]])],
      [[{ categoryName: 'Right' }]],
      100,
      100,
      false,
    )
    expect(Object.keys(slots).sort()).toEqual(['R1', 'R2', 'R3', 'R4', 'R5'])
    expect(slots.R1).toEqual({ x: 10, y: 20 })
    expect(slots.R5).toEqual({ x: 50, y: 20 })
  })

  it('mirror=true면 x가 좌우 반전된다 (셀프 뷰 scaleX(-1)과 일치)', () => {
    const slots = collectFingerSlots(
      [handLandmarks([[0.1, 0.5], [0, 0], [0, 0], [0, 0], [0, 0]])],
      [[{ categoryName: 'Left' }]],
      100,
      100,
      true,
    )
    expect(slots.L1).toEqual({ x: 90, y: 50 })
  })

  it('handedness를 알 수 없는 손은 무시한다', () => {
    const slots = collectFingerSlots([handLandmarks([[0.1, 0.1], [0, 0], [0, 0], [0, 0], [0, 0]])], [[]], 100, 100)
    expect(Object.keys(slots)).toHaveLength(0)
  })
})

describe('layoutConstellation', () => {
  it('정규화 좌표를 화면 중앙 기준 px로 변환한다', () => {
    const pts = layoutConstellation([[0.5, 0.5], [0, 0], [1, 1]], 200, 100, 0.5)
    // 짧은 변 100 * scale 0.5 = 50px 영역, 중심 (100, 50)
    expect(pts[0]).toEqual({ x: 100, y: 50 })
    expect(pts[1]).toEqual({ x: 75, y: 25 })
    expect(pts[2]).toEqual({ x: 125, y: 75 })
  })
})

describe('matchFingersToTargets', () => {
  const targets: Point[] = [
    { x: 10, y: 10 },
    { x: 50, y: 50 },
  ]

  it('반경 안의 손가락을 별에 1:1 매칭한다', () => {
    const { activeMask, positions, matchedSlots } = matchFingersToTargets(
      { R1: { x: 12, y: 10 }, L1: { x: 48, y: 52 } },
      targets,
      5,
    )
    expect(activeMask).toEqual([true, true])
    expect(positions[0]).toEqual({ x: 12, y: 10 })
    expect(matchedSlots.has('R1')).toBe(true)
    expect(matchedSlots.has('L1')).toBe(true)
  })

  it('손가락 하나가 여러 별을 동시에 켤 수 없다 (그리디 1:1)', () => {
    const near: Point[] = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
    ]
    const { activeMask } = matchFingersToTargets({ R1: { x: 12, y: 10 } }, near, 5)
    expect(activeMask.filter(Boolean)).toHaveLength(1)
  })

  it('반경 밖 손가락은 매칭되지 않는다', () => {
    const { activeMask } = matchFingersToTargets({ R1: { x: 30, y: 30 } }, targets, 5)
    expect(activeMask).toEqual([false, false])
  })
})

describe('computeRatioScore', () => {
  const target: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 30, y: 0 },
  ]

  it('거리 비율이 같으면(크기·위치 무관) 100점', () => {
    // 2배 확대 + 평행이동해도 비율은 동일
    const hit: Point[] = [
      { x: 100, y: 50 },
      { x: 120, y: 50 },
      { x: 160, y: 50 },
    ]
    expect(computeRatioScore(target, hit)).toBe(100)
  })

  it('비율이 어긋날수록 감점된다', () => {
    const hit: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 }, // 원본 1:2 비율이 1:1로 어긋남
      { x: 40, y: 0 },
    ]
    const score = computeRatioScore(target, hit)
    expect(score).toBeLessThan(100)
    expect(score).toBeGreaterThan(0)
  })

  it('점 개수가 다르면 0점', () => {
    expect(computeRatioScore(target, [{ x: 0, y: 0 }])).toBe(0)
  })
})

describe('partialScore', () => {
  it('미완성 라운드는 점등 비율로 최대 40점', () => {
    expect(partialScore(0, 5)).toBe(0)
    expect(partialScore(5, 5)).toBe(40)
    expect(partialScore(2, 5)).toBe(16)
  })
})
