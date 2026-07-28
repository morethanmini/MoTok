import { describe, expect, it } from 'vitest'
import { foldSeed, mulberry32 } from '../core/rng'

describe('mulberry32', () => {
  it('같은 시드는 같은 수열을 낸다 (결정성 — 대전 동일 채보의 전제)', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b())
  })

  it('다른 시드는 다른 수열을 낸다', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 10 }, a)
    const seqB = Array.from({ length: 10 }, b)
    expect(seqA).not.toEqual(seqB)
  })

  it('출력은 [0, 1) 범위', () => {
    const rng = mulberry32(987654321)
    for (let i = 0; i < 10000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('foldSeed', () => {
  it('서버 Long(64bit 문자열) 시드를 32bit로 접는다', () => {
    expect(foldSeed('9007199254740993')).toBe(foldSeed('9007199254740993'))
    expect(foldSeed(42)).toBe(42)
  })

  it('음수 시드도 유효한 uint32가 된다', () => {
    const v = foldSeed(-123456789)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(v)).toBe(true)
  })
})
