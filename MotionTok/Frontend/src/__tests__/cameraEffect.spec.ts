/**
 * 뽀샤시 세기 → CSS 값.
 *
 * 여기서 못박는 건 <b>세기를 올려도 얼굴을 알아볼 수 있다</b>는 것이다. 누가 누구인지 모르면
 * 게임이 안 되므로 블러·불투명도에 상한이 있어야 하고, 반대로 최소치에서도 "걸려 있다"는 게
 * 보여야 한다(0에서 아무 변화가 없으면 장착이 고장 난 것으로 읽힌다).
 *
 * 영상 자체에는 블러를 걸지 않는다는 것도 고정한다 — 거기에 블러를 걸면 눈·입까지 흐려져
 * 뽀샤시가 아니라 그냥 초점이 안 맞은 화면이 된다.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTENSITY,
  clampIntensity,
  glowStyle,
  videoFilter,
} from '@/features/decor/cameraEffect'

const px = (v: unknown) => Number(String(v).match(/blur\(([\d.]+)px\)/)?.[1])
const num = (v: unknown, fn: string) => Number(String(v).match(new RegExp(`${fn}\\(([\\d.]+)\\)`))?.[1])

describe('clampIntensity', () => {
  it('0~1로 자른다', () => {
    expect(clampIntensity(-1)).toBe(0)
    expect(clampIntensity(2)).toBe(1)
    expect(clampIntensity(0.42)).toBe(0.42)
  })

  it('숫자가 아니면 기본값 — 남이 보낸 값이 NaN이어도 효과가 사라지지 않게', () => {
    expect(clampIntensity(NaN)).toBe(DEFAULT_INTENSITY)
    expect(clampIntensity(Number.POSITIVE_INFINITY)).toBe(DEFAULT_INTENSITY)
  })
})

describe('videoFilter — 영상 자체 보정', () => {
  it('블러를 걸지 않는다 — 눈·입이 흐려지면 뽀샤시가 아니다', () => {
    expect(videoFilter(1)).not.toContain('blur')
  })

  it('세기를 올리면 밝기는 오르고 채도·대비는 내려간다', () => {
    const low = videoFilter(0)
    const high = videoFilter(1)
    expect(num(high, 'brightness')).toBeGreaterThan(num(low, 'brightness'))
    expect(num(high, 'saturate')).toBeLessThan(num(low, 'saturate'))
    expect(num(high, 'contrast')).toBeLessThan(num(low, 'contrast'))
  })

  it('채도를 올리지 않는다 — 빛 레이어가 이미 색을 띄우는데 여기서 더하면 얼굴이 붉게 뜬다', () => {
    expect(num(videoFilter(0.5), 'saturate')).toBeLessThan(1)
    expect(num(videoFilter(1), 'saturate')).toBeLessThan(1)
  })

  it('세기 0이면 영상을 건드리지 않는다(1배)', () => {
    expect(num(videoFilter(0), 'brightness')).toBe(1)
    expect(num(videoFilter(0), 'saturate')).toBe(1)
    expect(num(videoFilter(0), 'contrast')).toBe(1)
  })
})

describe('glowStyle — 겹치는 빛 레이어', () => {
  it('세기를 올리면 더 흐리고 더 진해진다', () => {
    const low = glowStyle(0)
    const high = glowStyle(1)
    expect(px(high.backdropFilter)).toBeGreaterThan(px(low.backdropFilter))
    expect(Number(high.opacity)).toBeGreaterThan(Number(low.opacity))
  })

  it('최소치에서도 눈에 보인다 — 장착했는데 아무 변화가 없으면 고장으로 읽힌다', () => {
    expect(px(glowStyle(0).backdropFilter)).toBeGreaterThan(0)
    expect(Number(glowStyle(0).opacity)).toBeGreaterThan(0.1)
  })

  it('최대치에서도 얼굴을 알아볼 수 있게 상한이 있다', () => {
    expect(px(glowStyle(1).backdropFilter)).toBeLessThanOrEqual(12)
    expect(Number(glowStyle(1).opacity)).toBeLessThanOrEqual(0.55)
  })

  it('Safari 접두사도 같은 값으로 함께 낸다', () => {
    const s = glowStyle(0.6) as Record<string, string>
    expect(s.WebkitBackdropFilter).toBe(s.backdropFilter)
  })

  it('범위를 벗어난 세기가 와도 상한 안에 있다 — 남이 보낸 값을 그대로 쓰지 않는다', () => {
    expect(px(glowStyle(99).backdropFilter)).toBe(px(glowStyle(1).backdropFilter))
    expect(glowStyle(-5).opacity).toBe(glowStyle(0).opacity)
  })
})
