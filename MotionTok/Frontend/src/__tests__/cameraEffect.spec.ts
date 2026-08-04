/**
 * 카메라 효과 세기·얼굴 위치 → CSS 값.
 *
 * 여기서 못박는 건 <b>세기를 올려도 얼굴을 알아볼 수 있다</b>는 것이다. 누가 누구인지 모르면
 * 게임이 안 되므로 블러·불투명도·어두움에 상한이 있어야 하고, 반대로 최소치에서도 "걸려 있다"는
 * 게 보여야 한다(0에서 아무 변화가 없으면 장착이 고장 난 것으로 읽힌다).
 *
 * 영상 자체에는 블러를 걸지 않는다는 것도 고정한다 — 거기에 블러를 걸면 눈·입까지 흐려져
 * 뽀샤시가 아니라 그냥 초점이 안 맞은 화면이 된다.
 *
 * 어두운 배경은 <b>구멍이 얼굴에 오는지</b>와, 얼굴을 놓쳤을 때 어둠이 얼굴을 덮지 않는지를
 * 함께 고정한다 — 후자를 놓치면 검출이 끊기는 순간 내 얼굴이 어두워져 고장으로 보인다.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTENSITY,
  SPOTLIGHT_CENTER_DROP,
  backgroundKindOf,
  clampIntensity,
  effectKindOf,
  glowStyle,
  hasGlowLayer,
  needsFaceAnchor,
  spotlightHole,
  spotlightStyle,
  videoFilter,
} from '@/features/decor/cameraEffect'
import type { FaceAnchor } from '@/features/decor/faceAnchor'

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

describe('videoFilter — 뽀샤시', () => {
  it('블러를 걸지 않는다 — 눈·입이 흐려지면 뽀샤시가 아니다', () => {
    expect(videoFilter('SOFT_GLOW', 1)).not.toContain('blur')
  })

  it('세기를 올리면 밝기는 오르고 채도·대비는 내려간다', () => {
    const low = videoFilter('SOFT_GLOW', 0)
    const high = videoFilter('SOFT_GLOW', 1)
    expect(num(high, 'brightness')).toBeGreaterThan(num(low, 'brightness'))
    expect(num(high, 'saturate')).toBeLessThan(num(low, 'saturate'))
    expect(num(high, 'contrast')).toBeLessThan(num(low, 'contrast'))
  })

  it('채도를 올리지 않는다 — 빛 레이어가 이미 색을 띄우는데 여기서 더하면 얼굴이 붉게 뜬다', () => {
    expect(num(videoFilter('SOFT_GLOW', 0.5), 'saturate')).toBeLessThan(1)
    expect(num(videoFilter('SOFT_GLOW', 1), 'saturate')).toBeLessThan(1)
  })

  it('세기 0이면 영상을 건드리지 않는다(1배)', () => {
    expect(num(videoFilter('SOFT_GLOW', 0), 'brightness')).toBe(1)
    expect(num(videoFilter('SOFT_GLOW', 0), 'saturate')).toBe(1)
    expect(num(videoFilter('SOFT_GLOW', 0), 'contrast')).toBe(1)
  })
})

describe('videoFilter — 흑백', () => {
  it('색을 뺀다', () => {
    expect(num(videoFilter('GRAYSCALE', 1), 'grayscale')).toBe(1)
  })

  it('세기를 올릴수록 더 빠진다', () => {
    const low = num(videoFilter('GRAYSCALE', 0), 'grayscale')
    const high = num(videoFilter('GRAYSCALE', 1), 'grayscale')
    expect(high).toBeGreaterThan(low)
  })

  it('세기 0에서도 눈에 띄게 빠진다 — 원본과 구분이 안 되면 장착이 안 된 줄 안다', () => {
    expect(num(videoFilter('GRAYSCALE', 0), 'grayscale')).toBeGreaterThanOrEqual(0.4)
  })

  it('블러를 걸지 않는다 — 흑백은 색만 빼는 효과다', () => {
    expect(videoFilter('GRAYSCALE', 1)).not.toContain('blur')
  })

  it('색을 빼며 밋밋해진 만큼 대비를 올린다', () => {
    expect(num(videoFilter('GRAYSCALE', 1), 'contrast')).toBeGreaterThan(1)
  })

  it('뽀샤시와 다른 값을 낸다 — 종류를 무시하고 한 가지로 그리면 안 된다', () => {
    expect(videoFilter('GRAYSCALE', 0.5)).not.toBe(videoFilter('SOFT_GLOW', 0.5))
  })
})

describe('effectKindOf — 아이템 그림에서 종류 찾기', () => {
  it('에셋 파일명으로 고른다', () => {
    expect(effectKindOf('/assets/item/effect/soft_glow.svg')).toBe('SOFT_GLOW')
    expect(effectKindOf('/assets/item/effect/grayscale.svg')).toBe('GRAYSCALE')
    expect(effectKindOf('https://cdn.example.com/x/grayscale.svg')).toBe('GRAYSCALE')
  })

  it('모르는 에셋·빈 값이면 걸지 않는다 — 엉뚱한 효과보다 아무것도 안 하는 게 낫다', () => {
    expect(effectKindOf('/assets/item/sticker/heart_1.png')).toBeNull()
    expect(effectKindOf('')).toBeNull()
    expect(effectKindOf(null)).toBeNull()
    expect(effectKindOf(undefined)).toBeNull()
  })
})

describe('backgroundKindOf — 배경 에셋에서 종류 찾기', () => {
  it('배경 에셋 파일명으로 고른다', () => {
    expect(backgroundKindOf('/assets/item/background/spotlight.svg')).toBe('SPOTLIGHT')
  })

  it('모르는 에셋·빈 값이면 걸지 않는다', () => {
    expect(backgroundKindOf('/assets/item/sticker/heart_1.png')).toBeNull()
    expect(backgroundKindOf('')).toBeNull()
    expect(backgroundKindOf(null)).toBeNull()
    expect(backgroundKindOf(undefined)).toBeNull()
  })

  /*
   * 효과와 배경은 <b>분류가 다른 칸</b>이라(각각 1개 장착) 목록이 섞이면 한쪽 슬롯에서
   * 다른 쪽 종류가 나와 엉뚱한 레이어로 그려진다. 두 조회가 서로를 모르는지 못박는다.
   */
  it('효과 에셋은 배경이 아니고, 배경 에셋은 효과가 아니다', () => {
    expect(backgroundKindOf('/assets/item/effect/soft_glow.svg')).toBeNull()
    expect(backgroundKindOf('/assets/item/effect/grayscale.svg')).toBeNull()
    expect(effectKindOf('/assets/item/background/spotlight.svg')).toBeNull()
  })
})

describe('hasGlowLayer — 겹치는 레이어가 필요한 종류', () => {
  it('뽀샤시만 빛 레이어를 쓴다', () => {
    expect(hasGlowLayer('SOFT_GLOW')).toBe(true)
    expect(hasGlowLayer('GRAYSCALE')).toBe(false)
  })
})

describe('needsFaceAnchor — 얼굴 추적을 켜야 하는 배경', () => {
  it('어두운 배경은 얼굴을 쓴다', () => {
    expect(needsFaceAnchor('SPOTLIGHT')).toBe(true)
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

// ── 어두운 배경(스포트라이트) ────────────────────────────────────────────────
const anchorAt = (x: number, y: number, scale = 0.3): FaceAnchor => ({ x, y, scale, rotation: 0 })
/** 16:9 박스에 딱 맞는 프레임(여백 없음). */
const FULL = { x: 0, y: 0, w: 400, h: 300 }

/*
 * 어두운 배경이 영상(`<video>`)에 걸리면 안 된다는 것 — 거기 걸면 프레임 전체에 균일하게
 * 먹어서 구멍이 되돌릴 수 없다 — 은 <b>타입이 막는다</b>(videoFilter는 EffectKind만 받는다).
 * 그래서 여기서 런타임으로 확인할 것이 없다. 아래는 실제로 어긋날 수 있는 값들만 본다.
 */

describe('spotlightHole — 뚫을 구멍의 자리와 크기', () => {
  it('얼굴 자리에 온다 — 가로는 앵커 그대로, 세로는 눈보다 조금 아래', () => {
    const hole = spotlightHole(anchorAt(0.5, 0.4), FULL, false)
    expect(hole).not.toBeNull()
    expect(hole!.cx).toBeCloseTo(200)
    // 눈높이(120px)보다 아래여야 턱이 어둠에 잠기지 않는다
    expect(hole!.cy).toBeCloseTo(120 + hole!.radius * SPOTLIGHT_CENTER_DROP)
    expect(hole!.cy).toBeGreaterThan(120)
  })

  it('반지름은 프레임 짧은 변을 기준으로 잡는다 — 가로로 늘어난 타일에서 커지지 않게', () => {
    const wide = spotlightHole(anchorAt(0.5, 0.4), { x: 0, y: 0, w: 800, h: 300 }, false)
    const square = spotlightHole(anchorAt(0.5, 0.4), { x: 0, y: 0, w: 300, h: 300 }, false)
    expect(wide!.radius).toBeCloseTo(square!.radius)
  })

  it('좌우 반전된 영상에서는 구멍도 뒤집힌다 — 안 뒤집으면 반대쪽 허공이 밝아진다', () => {
    const normal = spotlightHole(anchorAt(0.25, 0.4), FULL, false)
    const mirrored = spotlightHole(anchorAt(0.25, 0.4), FULL, true)
    expect(normal!.cx).toBeCloseTo(100)
    expect(mirrored!.cx).toBeCloseTo(300)
  })

  it('프레임 여백을 더해서 잡는다 — 박스가 곧 프레임이 아닐 때 가면과 어긋나지 않게', () => {
    const inset = spotlightHole(anchorAt(0.5, 0.5), { x: 50, y: 20, w: 400, h: 300 }, false)
    expect(inset!.cx).toBeCloseTo(250)
    expect(inset!.cy).toBeGreaterThan(170)
  })

  it('프레임을 아직 못 잡았거나 얼굴이 0 크기면 뚫지 않는다', () => {
    expect(spotlightHole(anchorAt(0.5, 0.5), { x: 0, y: 0, w: 0, h: 0 }, false)).toBeNull()
    expect(spotlightHole(anchorAt(0.5, 0.5, 0), FULL, false)).toBeNull()
  })
})

describe('spotlightStyle — 겹치는 어둠 레이어', () => {
  const hole = { cx: 200, cy: 130, radius: 50 }

  it('구멍을 마스크로 뚫는다 — 가운데는 투명(원본이 보인다)', () => {
    const s = spotlightStyle(0.5, hole, true) as Record<string, string>
    expect(s.maskImage).toContain('radial-gradient')
    expect(s.maskImage).toContain('50.0px')
    expect(s.maskImage).toContain('transparent')
    expect(Number(s.opacity)).toBe(1)
  })

  it('세기를 올리면 배경이 더 어둡고 더 흐려진다', () => {
    const low = spotlightStyle(0, hole, true)
    const high = spotlightStyle(1, hole, true)
    expect(num(high.backdropFilter, 'brightness')).toBeLessThan(
      num(low.backdropFilter, 'brightness'),
    )
    expect(px(high.backdropFilter)).toBeGreaterThan(px(low.backdropFilter))
  })

  it('세기 0에서도 배경이 어둡다 — 원본과 구분이 안 되면 장착이 안 된 줄 안다', () => {
    expect(num(spotlightStyle(0, hole, true).backdropFilter, 'brightness')).toBeLessThan(0.9)
  })

  it('최대치에서도 배경을 완전히 죽이지 않는다 — 누가 어디 있는지는 보여야 방이 읽힌다', () => {
    expect(num(spotlightStyle(1, hole, true).backdropFilter, 'brightness')).toBeGreaterThan(0.3)
  })

  it('얼굴을 놓치면 투명도만 0으로 내리고 <b>마스크는 남긴다</b>', () => {
    // 마스크를 지우면 사라지는 동안 구멍 없는 어둠이 얼굴을 덮어 깜빡임이 된다.
    const s = spotlightStyle(0.5, hole, false) as Record<string, string>
    expect(Number(s.opacity)).toBe(0)
    expect(s.maskImage).toContain('radial-gradient')
  })

  it('한 번도 얼굴을 못 찾았으면 아무것도 걸지 않는다', () => {
    const s = spotlightStyle(0.5, null, false) as Record<string, string>
    expect(Number(s.opacity)).toBe(0)
    expect(s.maskImage).toBeUndefined()
  })

  it('Safari 접두사도 같은 값으로 함께 낸다', () => {
    const s = spotlightStyle(0.6, hole, true) as Record<string, string>
    expect(s.WebkitBackdropFilter).toBe(s.backdropFilter)
    expect(s.WebkitMaskImage).toBe(s.maskImage)
  })

  it('범위를 벗어난 세기가 와도 상한 안에 있다 — 남이 보낸 값을 그대로 쓰지 않는다', () => {
    expect(spotlightStyle(99, hole, true).backdropFilter).toBe(
      spotlightStyle(1, hole, true).backdropFilter,
    )
    expect(spotlightStyle(-5, hole, true).backdropFilter).toBe(
      spotlightStyle(0, hole, true).backdropFilter,
    )
  })
})
