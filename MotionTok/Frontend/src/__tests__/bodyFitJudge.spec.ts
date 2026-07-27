/**
 * 게임④ 판정기 순수 로직 검증 (S15P11A706-46):
 * 픽셀 카운트·IoU·등급 임계·마진 이분 탐색 — 캔버스 없이 도는 부분만.
 * (실제 래스터라이즈 경로는 /dev/wall-lab에서 눈으로 검증한다)
 */
import { describe, expect, it } from 'vitest'
import {
  countMask,
  countOutside,
  findMarginForArea,
  gradeOf,
  iouOf,
} from '@/features/games/body-fit/judge'
import { defaultConfig } from '@/features/games/body-fit/config'

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
