/**
 * 게임④ 판정기 순수 로직 검증 (S15P11A706-46):
 * 픽셀 카운트·IoU·등급 임계·마진 이분 탐색 — 캔버스 없이 도는 부분만.
 * (실제 래스터라이즈 경로는 /dev/wall-lab에서 눈으로 검증한다)
 */
import { describe, expect, it } from 'vitest'
import {
  FAIL_MAX_SCORE,
  GRADE_POINTS,
  MIN_ROUND_SCORE,
  countMask,
  countOutside,
  findMarginForArea,
  gradeOf,
  iouOf,
  poseDifficulty,
  scoreFor,
  type RoundJudgment,
} from '@/features/games/body-fit/judge'
import { defaultConfig, type Grade } from '@/features/games/body-fit/config'
import type { Pt, SolvedSkeleton } from '@/features/games/body-fit/skeleton'

/** 알파 패턴으로 RGBA 버퍼 생성 — 1=칠해짐(alpha 255), 0=빈 픽셀 */
function mask(bits: number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(bits.length * 4)
  bits.forEach((b, i) => {
    data[i * 4 + 3] = b ? 255 : 0
  })
  return data
}

describe('픽셀 카운트', () => {
  it('countMask는 알파 픽셀 수를 센다', () => {
    expect(countMask(mask([1, 0, 1, 1]))).toBe(3)
  })

  it('countOutside는 a에만 있는 픽셀을 센다', () => {
    // a: ██·█  b: █··· → a & !b = 2
    expect(countOutside(mask([1, 1, 0, 1]), mask([1, 0, 0, 0]))).toBe(2)
  })

  it('iouOf는 교집합/합집합 ×100', () => {
    // a: ██··  b: ·██· → ∩=1, ∪=3
    expect(iouOf(mask([1, 1, 0, 0]), mask([0, 1, 1, 0]))).toBeCloseTo(100 / 3, 3)
  })

  it('빈 마스크끼리 IoU는 0 (NaN 아님)', () => {
    expect(iouOf(mask([0, 0]), mask([0, 0]))).toBe(0)
  })
})

describe('등급 임계 (UI 스펙 §1-4)', () => {
  const cfg = defaultConfig()
  it.each([
    [92, 'PERFECT'],
    [91.9, 'GREAT'],
    [82, 'GREAT'],
    [81.9, 'PASS'],
    [70, 'PASS'],
    [69.9, 'FAIL'],
  ] as const)('IoU %s → %s', (iou, grade) => {
    expect(gradeOf(iou, cfg)).toBe(grade)
  })
})

describe('마진 이분 탐색 (UI 스펙 §2-3)', () => {
  it('면적 모델 (1+m)²에서 목표 K=2를 만드는 m ≈ √2−1로 수렴한다', () => {
    // 원본 면적 1, 마진 m일 때 면적 (1+m)² 라고 가정 → 목표 2 → m = √2−1 ≈ 0.414
    const m = findMarginForArea((margin) => (1 + margin) ** 2, 2)
    expect(m).toBeCloseTo(Math.SQRT2 - 1, 2)
  })

  it('목표가 탐색 범위 밖이면 경계값으로 수렴한다 (발산하지 않음)', () => {
    expect(findMarginForArea(() => 1, 999)).toBeLessThanOrEqual(0.6)
    expect(findMarginForArea(() => 999, 1)).toBeGreaterThanOrEqual(0)
  })
})

describe('출제 난이도 휴리스틱 (관전 화면 별점)', () => {
  /** 어깨(±0.5, 0) 기준 골격 — 팔 좌표만 바꿔 넣는다 */
  function skel(
    elbowL: Pt, wristL: Pt, elbowR: Pt, wristR: Pt,
  ): SolvedSkeleton {
    return {
      anchor: { x: 0, y: 0 },
      head: { x: 0, y: 0.5 },
      shoulderL: { x: -0.5, y: 0 },
      shoulderR: { x: 0.5, y: 0 },
      hip: { x: 0, y: -1 },
      elbowL, wristL, elbowR, wristR,
    } as SolvedSkeleton
  }
  /** 차렷 — 양팔 아래로 쭉 */
  const rest = skel(
    { x: -0.5, y: -0.5 }, { x: -0.5, y: -1 },
    { x: 0.5, y: -0.5 }, { x: 0.5, y: -1 },
  )
  /** 만세 — 양팔 위로 쭉 */
  const raised = skel(
    { x: -0.5, y: 0.5 }, { x: -0.5, y: 1 },
    { x: 0.5, y: 0.5 }, { x: 0.5, y: 1 },
  )
  /** 한 팔만 위 — 비대칭 */
  const oneArm = skel(
    { x: -0.5, y: 0.5 }, { x: -0.5, y: 1 },
    { x: 0.5, y: -0.5 }, { x: 0.5, y: -1 },
  )

  it('차렷이 가장 쉽다(0)', () => {
    expect(poseDifficulty(rest)).toBeCloseTo(0, 5)
  })

  it('팔을 들면 어려워진다', () => {
    expect(poseDifficulty(raised)).toBeGreaterThan(poseDifficulty(rest))
  })

  it('팔꿈치를 접으면 같은 높이라도 더 어렵다', () => {
    // 팔은 아래로 뻗되 손목만 위로 접어 올린다(팔꿈치 굽힘만 추가)
    const folded = skel(
      { x: -0.5, y: -0.5 }, { x: -0.5, y: 0 },
      { x: 0.5, y: -0.5 }, { x: 0.5, y: 0 },
    )
    expect(poseDifficulty(folded)).toBeGreaterThan(poseDifficulty(rest))
  })

  it('비대칭이 대칭보다 어렵다 — 한 팔만 든 쪽이 양팔 평균 리프트가 같아도 더 높다', () => {
    // oneArm: 리프트 평균 = (π + 0)/2, 양팔 절반만 든 대칭 포즈와 평균이 같다
    const bothHalf = skel(
      { x: -1, y: 0 }, { x: -1.5, y: 0 },
      { x: 1, y: 0 }, { x: 1.5, y: 0 },
    )
    expect(poseDifficulty(oneArm)).toBeGreaterThan(poseDifficulty(bothHalf))
  })

  it('항상 0~1 범위 (별점 계산이 범위를 벗어나지 않는다)', () => {
    for (const s of [rest, raised, oneArm]) {
      expect(poseDifficulty(s)).toBeGreaterThanOrEqual(0)
      expect(poseDifficulty(s)).toBeLessThanOrEqual(1)
    }
  })
})

describe('점수 산정 (실패해도 일치율만큼 부분 점수)', () => {
  const judgment = (grade: Grade, iou: number, passed = grade !== 'FAIL'): RoundJudgment => ({
    outsideRatio: passed ? 0 : 0.5,
    passed,
    iou,
    grade,
    overflow: [],
  })

  it('통과 등급은 기존 고정 점수 그대로', () => {
    expect(scoreFor(judgment('PERFECT', 95))).toBe(100)
    expect(scoreFor(judgment('GREAT', 85))).toBe(85)
    expect(scoreFor(judgment('PASS', 75))).toBe(70)
  })

  it('실패해도 일치율에 비례해 점수를 준다', () => {
    expect(scoreFor(judgment('FAIL', 0))).toBe(MIN_ROUND_SCORE)
    expect(scoreFor(judgment('FAIL', 50))).toBe(30)
    expect(scoreFor(judgment('FAIL', 100))).toBe(FAIL_MAX_SCORE)
  })

  it('어떤 판정에서도 0점은 나오지 않는다', () => {
    const grades: Grade[] = ['PERFECT', 'GREAT', 'PASS', 'FAIL']
    for (const grade of grades) {
      for (const iou of [0, 1, 25, 50, 75, 99, 100]) {
        expect(scoreFor(judgment(grade, iou))).toBeGreaterThanOrEqual(MIN_ROUND_SCORE)
      }
    }
    // 인식이 아예 안 돼 iou 0으로 떨어지는 경로(finalizeJudgment 폴백)도 포함
    expect(scoreFor({ outsideRatio: 1, passed: false, iou: 0, grade: 'FAIL', overflow: [] })).toBe(
      MIN_ROUND_SCORE,
    )
  })

  it('일치율이 높을수록 실패 점수도 높다(단조 증가)', () => {
    const scores = [10, 30, 50, 70, 90].map((iou) => scoreFor(judgment('FAIL', iou)))
    expect(scores).toEqual([...scores].sort((a, b) => a - b))
    expect(new Set(scores).size).toBe(scores.length)
  })

  it('삐져나오진 않았지만 모양이 안 맞아 FAIL인 경우에도 부분 점수', () => {
    // passed=true인데 IoU가 낮아 등급만 FAIL — 0점 경로가 둘이라 grade로 갈라야 한다
    expect(scoreFor(judgment('FAIL', 50, true))).toBe(30)
  })

  it('실패 점수는 어떤 등급 점수와도 겹치지 않는다 — 겹치면 등급 배지가 오표시된다', () => {
    const gradePoints = new Set(Object.values(GRADE_POINTS).filter((p) => p > 0))
    for (let iou = 0; iou <= 100; iou++) {
      expect(gradePoints.has(scoreFor(judgment('FAIL', iou)))).toBe(false)
    }
    expect(FAIL_MAX_SCORE).toBeLessThan(GRADE_POINTS.PASS)
  })
})
