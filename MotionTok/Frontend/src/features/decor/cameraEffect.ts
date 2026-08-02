/**
 * 카메라 프레임 전체에 걸리는 효과 — 종류 + 세기에서 CSS 값을 만든다.
 *
 * <b>영상 픽셀을 바꾸는 효과라 그림(PNG)으로는 안 된다.</b> 반투명 그림을 덮는 것으로는
 * 뽀샤시의 "피부는 부드러운데 눈·입은 선명하다"도, 흑백의 색 제거도 만들 수 없다.
 *
 * <b>CSS로 거는 이유 — 모션 인식에 영향이 없다.</b> filter는 DOM 표시에만 적용되고 LiveKit
 * 트랙과 MediaPipe가 읽는 원본 프레임은 그대로다. canvas로 송출 스트림에 구우면 손질된
 * 프레임을 손·포즈 인식이 읽어 인식률이 떨어지고 CPU도 더 쓴다.
 */
import type { CSSProperties } from 'vue'

/** 효과 종류. 새 효과를 더하면 여기와 아래 두 곳(EFFECT_BY_ASSET·videoFilter)만 손대면 된다. */
export type EffectKind = 'SOFT_GLOW' | 'GRAYSCALE'

export const EFFECT_LABEL: Record<EffectKind, string> = {
  SOFT_GLOW: '뽀샤시',
  GRAYSCALE: '흑백',
}

/**
 * 아이템 이미지 파일명 → 효과 종류.
 *
 * <p>종류를 DB에 두지 않는다. 효과를 어떻게 그릴지는 순전히 클라이언트 렌더링 문제이고,
 * 그 그림 파일도 프론트가 들고 있다 — "이 에셋은 이 렌더러" 관계가 프론트 안에서 닫힌다.
 * 서버는 분류(EFFECT)까지만 알면 된다.</p>
 *
 * <p>여기 없는 에셋이면 효과를 걸지 않는다. 모르는 아이템에 아무 효과나 걸면 산 것과 다른 게
 * 나오는데, 그건 아무 일도 없는 것보다 알아채기 어렵다.</p>
 */
const EFFECT_BY_ASSET: Record<string, EffectKind> = {
  'soft_glow.svg': 'SOFT_GLOW',
  'grayscale.svg': 'GRAYSCALE',
}

/** 아이템 이미지 주소에서 효과 종류를 찾는다. 모르는 에셋이면 null(효과 없음). */
export function effectKindOf(imageUrl: string | null | undefined): EffectKind | null {
  if (!imageUrl) return null
  const file = imageUrl.split('/').pop() ?? ''
  return EFFECT_BY_ASSET[file] ?? null
}

/** 세기 0~1. 0이어도 "걸려 있다"는 게 보여야 해서 최솟값에서도 눈에 보이게 걸린다. */
export const MIN_INTENSITY = 0
export const MAX_INTENSITY = 1
export const DEFAULT_INTENSITY = 0.5

export const clampIntensity = (v: number) =>
  Number.isFinite(v) ? Math.min(MAX_INTENSITY, Math.max(MIN_INTENSITY, v)) : DEFAULT_INTENSITY

/** 세기별 상한 — 최대치에서도 얼굴을 알아볼 수 있어야 한다(누가 누구인지 모르면 게임이 안 된다). */
const MAX_BLUR_PX = 9
const MAX_GLOW_OPACITY = 0.5

/**
 * 뽀샤시의 영상 보정폭(세기 최대 기준). 세기를 조절할 때 만질 값은 여기 셋뿐이다.
 *
 * <b>채도는 올리지 않고 낮춘다.</b> 뽀샤시는 밝고 옅은 느낌이라 색이 진해지면 방향이 반대가 된다
 * — 빛을 더하는 레이어가 이미 색을 띄워 주므로 여기서 채도까지 올리면 얼굴이 붉게 뜬다.
 */
const MAX_BRIGHTNESS_GAIN = 0.08
const MAX_SATURATE_DROP = 0.14
const MAX_CONTRAST_DROP = 0.06

/**
 * 흑백의 최소 강도 — 세기 0에서도 이만큼은 색을 뺀다.
 *
 * 0부터 시작하면 세기를 내렸을 때 원본과 구분이 안 돼 "장착이 안 됐나" 싶어진다.
 * 뽀샤시의 빛 레이어가 최소치에서도 보이는 것과 같은 판단이다.
 */
const MIN_GRAYSCALE = 0.5
/** 흑백은 색을 빼면 밋밋해져서 대비를 조금 올려 준다(필름 흑백의 느낌). */
const MAX_GRAY_CONTRAST_GAIN = 0.12

/** 영상 자체에 거는 보정. 뽀샤시는 여기서 블러를 걸지 않는다 — 걸면 눈·입까지 흐려진다. */
export function videoFilter(kind: EffectKind, intensity: number): string {
  const t = clampIntensity(intensity)
  if (kind === 'GRAYSCALE') {
    const gray = (MIN_GRAYSCALE + (1 - MIN_GRAYSCALE) * t).toFixed(3)
    const contrast = (1 + MAX_GRAY_CONTRAST_GAIN * t).toFixed(3)
    return `grayscale(${gray}) contrast(${contrast})`
  }
  const brightness = (1 + MAX_BRIGHTNESS_GAIN * t).toFixed(3)
  const saturate = (1 - MAX_SATURATE_DROP * t).toFixed(3)
  const contrast = (1 - MAX_CONTRAST_DROP * t).toFixed(3)
  return `brightness(${brightness}) saturate(${saturate}) contrast(${contrast})`
}

/** 영상 위에 빛 레이어를 겹치는 종류인지. 흑백은 겹칠 것이 없어 filter 하나로 끝난다. */
export const hasGlowLayer = (kind: EffectKind) => kind === 'SOFT_GLOW'

/**
 * 뽀샤시의 빛 레이어. `backdrop-filter`가 뒤 영상을 흐리게 떠 오고,
 * `screen` 합성이 그걸 밝은 쪽으로만 더해 피부가 부드러워진다(윤곽은 원본이 남는다).
 */
export function glowStyle(intensity: number): CSSProperties {
  const t = clampIntensity(intensity)
  return {
    backdropFilter: `blur(${(2 + MAX_BLUR_PX * t).toFixed(2)}px) brightness(${(1 + 0.14 * t).toFixed(3)})`,
    // Safari는 아직 접두사가 필요하다
    WebkitBackdropFilter: `blur(${(2 + MAX_BLUR_PX * t).toFixed(2)}px) brightness(${(1 + 0.14 * t).toFixed(3)})`,
    opacity: (0.16 + (MAX_GLOW_OPACITY - 0.16) * t).toFixed(3),
  } as CSSProperties
}

/** 걸려 있는 프레임 효과. 종류를 함께 들고 다녀야 남의 타일에도 같은 효과를 그릴 수 있다. */
export interface CameraEffect {
  itemId: number
  kind: EffectKind
  intensity: number
}
