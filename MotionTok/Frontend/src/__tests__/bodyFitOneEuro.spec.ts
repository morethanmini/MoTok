/**
 * 게임④ 아바타 랩 핵심 로직 검증 (S15P11A706-136):
 * One Euro Filter가 "정지 시 지터 억제 + 이동 시 낮은 지연"이라는 계약을 지키는지,
 * 포즈 정규화가 어깨너비=1·원점=어깨중점 규칙을 지키는지.
 */
import { describe, expect, it } from 'vitest'
import { PoseSmoother } from '@/features/games/body-fit/oneEuro'
import { normalizePose, type LandmarkPoint } from '@/features/games/body-fit/avatarRig'

const FRAME_MS = 33.3 // 30fps

describe('PoseSmoother (One Euro Filter)', () => {
  const makeSmoother = () => new PoseSmoother({ minCutoff: 1.2, beta: 0.4 }, 1)

  it('정지 신호에 실린 고주파 지터를 절반 이하로 줄인다', () => {
    const s = makeSmoother()
    const rawDev: number[] = []
    const outDev: number[] = []
    for (let i = 0; i < 120; i++) {
      const x = 0.5 + 0.01 * Math.sin(i * 2.7) // MediaPipe 지터를 흉내낸 결정적 노이즈
      const out = s.apply([{ x, y: 0 }], i * FRAME_MS)[0]!.x
      if (i >= 30) {
        // 필터가 자리잡은 뒤 구간만 측정
        rawDev.push(Math.abs(x - 0.5))
        outDev.push(Math.abs(out - 0.5))
      }
    }
    const mean = (arr: number[]) => arr.reduce((a, v) => a + v, 0) / arr.length
    expect(mean(outDev)).toBeLessThan(mean(rawDev) * 0.5)
  })

  it('등속 이동을 큰 지연 없이 따라온다', () => {
    const s = makeSmoother()
    let last = 0
    for (let i = 0; i < 60; i++) {
      // 2초 동안 0 → 1 로 이동 (팔을 천천히 드는 속도)
      last = s.apply([{ x: 0, y: i / 60 }], i * FRAME_MS)[0]!.y
    }
    expect(last).toBeGreaterThan(0.9) // 입력 최종값 0.983 대비 지연 0.08 이하
  })

  it('reset 후 첫 샘플은 필터링 없이 그대로 통과한다', () => {
    const s = makeSmoother()
    s.apply([{ x: 0, y: 0 }], 0)
    s.reset()
    expect(s.apply([{ x: 7, y: 0 }], FRAME_MS)[0]!.x).toBe(7)
  })
})

describe('normalizePose', () => {
  /** 어깨만 보이는 최소 랜드마크 세트 */
  function landmarks(): LandmarkPoint[] {
    const lm: LandmarkPoint[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      visibility: 0,
    }))
    lm[11] = { x: 0.65, y: 0.42, visibility: 1 } // 왼어깨
    lm[12] = { x: 0.35, y: 0.38, visibility: 1 } // 오른어깨
    return lm
  }

  it('어깨너비=1, 원점=어깨 중점으로 정규화한다', () => {
    const p = normalizePose(landmarks(), false)!
    expect(p).not.toBeNull()
    const dist = Math.hypot(p.shoulderL.x - p.shoulderR.x, p.shoulderL.y - p.shoulderR.y)
    expect(dist).toBeCloseTo(1, 5)
    expect((p.shoulderL.x + p.shoulderR.x) / 2).toBeCloseTo(0, 5)
    expect((p.shoulderL.y + p.shoulderR.y) / 2).toBeCloseTo(0, 5)
  })

  it('mirror는 x만 뒤집는다', () => {
    const plain = normalizePose(landmarks(), false)!
    const mirrored = normalizePose(landmarks(), true)!
    expect(mirrored.shoulderL.x).toBeCloseTo(-plain.shoulderL.x, 5)
    expect(mirrored.shoulderL.y).toBeCloseTo(plain.shoulderL.y, 5)
  })

  it('어깨 신뢰도가 낮으면 null — 마지막 포즈 유지 신호', () => {
    const lm = landmarks()
    lm[11] = { x: 0.65, y: 0.42, visibility: 0.2 }
    expect(normalizePose(lm, false)).toBeNull()
  })

  it('신뢰도 미달 관절은 null로 내려온다 (프레임 밖 팔)', () => {
    const p = normalizePose(landmarks(), false)!
    expect(p.elbowL).toBeNull()
    expect(p.wristR).toBeNull()
    expect(p.hipMid).toBeNull()
  })
})
