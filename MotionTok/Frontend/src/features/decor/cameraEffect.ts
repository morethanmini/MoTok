/**
 * 카메라 프레임 전체에 걸리는 효과(뽀샤시) — 세기에서 CSS 값을 만든다.
 *
 * <b>영상 픽셀을 바꾸는 효과라 그림(PNG)으로는 안 된다.</b> 반투명 흰 그림을 덮으면 화면이
 * 뿌옇게 되기만 하고, 뽀샤시의 요점인 "피부는 부드러운데 눈·입은 선명하다"가 나오지 않는다.
 *
 * <b>CSS로 거는 이유 — 모션 인식에 영향이 없다.</b> filter는 DOM 표시에만 적용되고 LiveKit
 * 트랙과 MediaPipe가 읽는 원본 프레임은 그대로다. canvas로 송출 스트림에 구우면 블러 걸린
 * 프레임을 손·포즈 인식이 읽어 인식률이 떨어지고 CPU도 더 쓴다.
 *
 * 만드는 방법은 원본 + 흐린 사본을 밝게 합성하는 것이다. 영상을 두 개 붙이지 않고
 * `backdrop-filter`로 뒤 영상을 흐리게 떠서 `screen`으로 겹치면 사본이 필요 없다.
 */
import type { CSSProperties } from 'vue'

/** 세기 0~1. 0이어도 "걸려 있다"는 게 보여야 해서 최솟값에서도 아주 약하게는 걸린다. */
export const MIN_INTENSITY = 0
export const MAX_INTENSITY = 1
export const DEFAULT_INTENSITY = 0.5

export const clampIntensity = (v: number) =>
  Number.isFinite(v) ? Math.min(MAX_INTENSITY, Math.max(MIN_INTENSITY, v)) : DEFAULT_INTENSITY

/** 세기별 상한 — 최대치에서도 얼굴을 알아볼 수 있어야 한다(누가 누구인지 모르면 게임이 안 된다). */
const MAX_BLUR_PX = 9
const MAX_GLOW_OPACITY = 0.5

/**
 * 세기 최대에서의 영상 보정폭. 세기를 조절할 때 만질 값은 여기 셋뿐이다.
 *
 * <b>채도는 올리지 않고 낮춘다.</b> 뽀샤시는 밝고 옅은 느낌이라 색이 진해지면 방향이 반대가 된다
 * — 빛을 더하는 레이어가 이미 색을 띄워 주므로 여기서 채도까지 올리면 얼굴이 붉게 뜬다.
 */
const MAX_BRIGHTNESS_GAIN = 0.08
const MAX_SATURATE_DROP = 0.14
const MAX_CONTRAST_DROP = 0.06

/** 영상 자체에 거는 보정 — 살짝만. 여기서 블러를 걸면 눈·입까지 흐려진다. */
export function videoFilter(intensity: number): string {
  const t = clampIntensity(intensity)
  const brightness = (1 + MAX_BRIGHTNESS_GAIN * t).toFixed(3)
  const saturate = (1 - MAX_SATURATE_DROP * t).toFixed(3)
  const contrast = (1 - MAX_CONTRAST_DROP * t).toFixed(3)
  return `brightness(${brightness}) saturate(${saturate}) contrast(${contrast})`
}

/**
 * 영상 위에 겹치는 빛 레이어. `backdrop-filter`가 뒤 영상을 흐리게 떠 오고,
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

/** 이 효과가 걸려 있는지 — 세기가 있어도 아이템이 없으면 아무것도 하지 않는다. */
export interface CameraEffect {
  itemId: number
  intensity: number
}
