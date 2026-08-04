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
import { clamp01 } from './sticker'
import type { FaceAnchor } from './faceAnchor'
import type { FrameRect } from './frameBox'

/**
 * 프레임 <b>전체</b>에 균일하게 걸리는 효과(분류 EFFECT). 새 종류를 더하면 여기와
 * EFFECT_BY_ASSET·videoFilter만 손대면 된다.
 */
export type EffectKind = 'SOFT_GLOW' | 'GRAYSCALE'

/**
 * 사람 <b>뒤쪽</b>에만 걸리는 것(분류 BACKGROUND).
 *
 * 종류를 EffectKind와 나눠 둔 이유 — 배경은 자리에 따라 다르게 걸려서 얼굴 위치가 필요하고
 * ({@link needsFaceAnchor}) 마스크를 만드는 함수가 따로 있다. 한 유니온으로 합치면
 * {@link videoFilter}·{@link hasGlowLayer}가 배경 종류까지 받게 되어, 거기서 "이건 여기 오면
 * 안 되는 값"을 방어하는 분기가 생긴다. 타입으로 못 오게 하는 편이 낫다.
 */
export type BackgroundKind = 'SPOTLIGHT'

/** 카메라에 걸리는 것 전부 — 겹치는 레이어 컴포넌트가 받는 값. */
export type CameraLayerKind = EffectKind | BackgroundKind

/** 세기 슬라이더 라벨. 효과·배경을 함께 담는다(둘 다 세기를 갖는다). */
export const EFFECT_LABEL: Record<CameraLayerKind, string> = {
  SOFT_GLOW: '뽀샤시',
  GRAYSCALE: '흑백',
  SPOTLIGHT: '어두운 배경',
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

/** 배경 에셋 → 종류. 효과와 나눠 두는 이유는 {@link BackgroundKind} 주석. */
const BACKGROUND_BY_ASSET: Record<string, BackgroundKind> = {
  'spotlight.svg': 'SPOTLIGHT',
}

const fileNameOf = (imageUrl: string) => imageUrl.split('/').pop() ?? ''

/** 아이템 이미지 주소에서 효과 종류를 찾는다. 모르는 에셋이면 null(효과 없음). */
export function effectKindOf(imageUrl: string | null | undefined): EffectKind | null {
  if (!imageUrl) return null
  return EFFECT_BY_ASSET[fileNameOf(imageUrl)] ?? null
}

/** 아이템 이미지 주소에서 배경 종류를 찾는다. 모르는 에셋이면 null(아무것도 걸지 않음). */
export function backgroundKindOf(imageUrl: string | null | undefined): BackgroundKind | null {
  if (!imageUrl) return null
  return BACKGROUND_BY_ASSET[fileNameOf(imageUrl)] ?? null
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
 * 이 배경이 <b>얼굴 추적</b>을 필요로 하는지.
 *
 * 켜야 할 것이 둘이다 — 얼굴 검출기(useFaceAnchor)와, 잡은 앵커를 남에게 흘려보내는 것
 * (decorSync). 둘 중 하나만 켜면 내 화면에서만 보이거나 남의 화면에서만 보인다.
 *
 * 배경이라고 다 얼굴이 필요한 것은 아니다 — 나중에 그림을 깔거나 프레임을 두르는 배경이
 * 생기면 그건 얼굴 없이 그려진다. 그래서 "배경이면 켠다"가 아니라 종류로 판단한다.
 */
export const needsFaceAnchor = (kind: BackgroundKind) => kind === 'SPOTLIGHT'

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

// ── 어두운 배경(스포트라이트) ────────────────────────────────────────────────
/*
 * 배경을 어둡게·흐리게 덮고 얼굴 자리에 둥근 구멍을 뚫어 얼굴만 떠 보이게 한다.
 *
 * <b>영상(`<video>`)에는 아무것도 걸지 않는다</b> — 그래서 이것은 videoFilter를 타지 않는다.
 * 거기 걸면 프레임 전체에 균일하게 먹는데, 얼굴 구멍은 위에 겹치는 레이어의 마스크라
 * 이미 걸린 것을 되돌릴 수 없다(얼굴까지 같이 어두워진다). 어둡게·흐리게 하는 일은 전부
 * 이 아래의 레이어가 맡는다.
 *
 * <b>사람과 배경을 가르지 않는다.</b> 그건 세그멘테이션 모델이 필요하고, 원격 타일 8개에
 * 각각 돌릴 수 없어 송출 프레임에 구워 보내야 한다(인식률·CPU를 함께 잃는다). 대신 이미 있는
 * 얼굴 검출기의 앵커 하나(숫자 넷)로 <b>원</b>을 뚫는다 — 목·어깨는 어둠에 남지만, 원형 구멍은
 * 보는 사람이 "의도한 연출"로 읽는다. 몸 모양을 어설프게 따라가면 그 순간부터 실제 윤곽과의
 * 어긋남이 전부 고장으로 보인다.
 *
 * 앵커는 이미 데이터 채널로 30fps 흐르고 있어(decorSync의 DECOR_FACE_TOPIC) 남의 타일에도
 * 같은 구멍이 뚫린다 — 받는 쪽은 좌표로 그리기만 하므로 검출기를 하나도 더 돌리지 않는다.
 */

/**
 * 구멍 반지름 ÷ (앵커 scale × 프레임 짧은 변).
 *
 * 앵커의 scale은 <b>가면(탈) 폭</b>이라 머리를 덮는 크기다. 0.5면 <b>구멍 지름이 가면 폭과 같다</b> —
 * 가면 자체가 MASK_SIZE_BOOST 만큼 넉넉한 크기라 이걸로 머리가 들어온다.
 *
 * ⚠ 실기 미검증 시작값이다. 얼굴이 잘리면 올리고, 어깨까지 밝아지면 내린다.
 */
export const SPOTLIGHT_RADIUS_RATIO = 0.5

/**
 * 원 중심을 눈높이에서 <b>아래로</b> 내리는 양(반지름 대비).
 *
 * 앵커는 두 눈의 중앙인데 얼굴 중심은 그보다 아래다. 안 내리면 턱이 어둠에 잠기고
 * 이마 위 허공이 밝아져, 구멍이 얼굴이 아니라 머리 위에 걸린 것처럼 보인다.
 */
export const SPOTLIGHT_CENTER_DROP = 0.22

/** 구멍 안쪽이 완전히 투명한 구간(반지름 대비). 이 밖에서 테두리까지 부드럽게 닫힌다. */
const SPOTLIGHT_CORE = 0.62

/**
 * 배경을 얼마나 어둡게 할지 — 세기 0에서도 최소만큼은 어둡게 한다.
 * 0부터 시작하면 원본과 구분이 안 돼 "장착이 안 됐나" 싶어진다(흑백의 MIN_GRAYSCALE과 같은 판단).
 *
 * 최대에서도 배경을 완전히 죽이지 않는 이유 — 누가 어디에 있는지는 보여야 방 안이 읽힌다.
 */
const MIN_SPOT_DIM = 0.18
const MAX_SPOT_DIM = 0.58
/** 배경 블러. 얼굴 쪽으로 조금 번져 구멍 테두리를 부드럽게 해 준다. */
const MAX_SPOT_BLUR_PX = 4

/** 화면(박스) 좌표계의 구멍 하나 — px. */
export interface SpotlightHole {
  cx: number
  cy: number
  radius: number
}

/**
 * 얼굴 앵커 + 프레임 사각형 → 뚫을 구멍.
 *
 * @param mirrored 좌우 반전된 영상 위인지(자기 미리보기). 안 뒤집으면 구멍이 반대쪽에 뚫린다 —
 *                 StickerOverlay가 가면에 하는 것과 같은 보정이다.
 * @returns 프레임이 아직 안 잡혔거나 반지름이 0이면 null(뚫을 것이 없다)
 */
export function spotlightHole(
  anchor: FaceAnchor,
  frame: FrameRect,
  mirrored: boolean,
): SpotlightHole | null {
  const short = Math.min(frame.w, frame.h)
  if (short <= 0) return null

  const radius = Math.max(anchor.scale, 0) * short * SPOTLIGHT_RADIUS_RATIO
  if (radius <= 0) return null

  // 회전(anchor.rotation)은 쓰지 않는다 — 원은 돌려도 같은 모양이다.
  const nx = mirrored ? 1 - clamp01(anchor.x) : clamp01(anchor.x)
  return {
    cx: frame.x + nx * frame.w,
    cy: frame.y + clamp01(anchor.y) * frame.h + radius * SPOTLIGHT_CENTER_DROP,
    radius,
  }
}

/**
 * 어두운 배경 레이어의 스타일.
 *
 * `backdrop-filter`가 뒤 영상을 어둡게·흐리게 떠 오고, `mask-image`의 가운데 투명한 원이
 * 그 어둠에서 얼굴만 오려 낸다(마스크가 투명한 곳은 이 레이어가 그려지지 않아 원본이 보인다).
 *
 * @param hole    뚫을 구멍. <b>얼굴을 놓친 동안에도 마지막 구멍을 그대로 넘긴다</b> — 아래 visible 참고
 * @param visible 지금 얼굴이 잡혀 있는지. false면 투명도만 0으로 내린다 —
 *                구멍을 없애면 사라지는 동안 <b>구멍 없는 어둠이 얼굴을 덮어</b> 페이드아웃이
 *                오히려 깜빡임이 된다. 효과가 사라지는 건 얼굴이 어두워지는 것보다 낫다.
 */
export function spotlightStyle(
  intensity: number,
  hole: SpotlightHole | null,
  visible: boolean,
): CSSProperties {
  const t = clampIntensity(intensity)
  const dim = MIN_SPOT_DIM + (MAX_SPOT_DIM - MIN_SPOT_DIM) * t
  const filter = `blur(${(MAX_SPOT_BLUR_PX * t).toFixed(2)}px) brightness(${(1 - dim).toFixed(3)})`

  const style: CSSProperties = {
    backdropFilter: filter,
    // Safari는 아직 접두사가 필요하다
    WebkitBackdropFilter: filter,
    opacity: visible && hole ? 1 : 0,
  } as CSSProperties

  if (!hole) return style
  const mask =
    `radial-gradient(circle ${hole.radius.toFixed(1)}px` +
    ` at ${hole.cx.toFixed(1)}px ${hole.cy.toFixed(1)}px,` +
    ` transparent 0, transparent ${(SPOTLIGHT_CORE * 100).toFixed(0)}%, #000 100%)`
  return { ...style, maskImage: mask, WebkitMaskImage: mask } as CSSProperties
}

/** 걸려 있는 프레임 효과. 종류를 함께 들고 다녀야 남의 타일에도 같은 효과를 그릴 수 있다. */
export interface CameraEffect {
  itemId: number
  kind: EffectKind
  intensity: number
}

/**
 * 걸려 있는 배경. 모양은 {@link CameraEffect}와 같지만 <b>다른 값</b>이다 —
 * 효과와 배경은 각각 1개씩 동시에 걸릴 수 있어 한 변수에 담을 수 없다.
 */
export interface CameraBackground {
  itemId: number
  kind: BackgroundKind
  intensity: number
}
