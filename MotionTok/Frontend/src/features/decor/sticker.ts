/**
 * 스티커 배치 공용 규칙.
 *
 * 편집기와 내 타일·상대 타일이 모두 같은 좌표 계산을 써야 "편집할 때 놓은 자리"와
 * "상대가 보는 자리"가 일치한다. 그래서 크기·위치 계산을 이 파일 하나에 둔다.
 *
 * 좌표 규약
 *  - x·y : 영상 프레임 기준 0~1 정규화 좌표. 스티커의 <b>중심</b>이다.
 *  - scale: 영상의 <b>짧은 변</b> 대비 스티커 너비 비율. 가로/세로 어느 쪽이 길어도 체감 크기가 유지된다.
 */
import type { DecorPlacement } from '@/api'

/** 배치 + 그릴 이미지 주소. 인벤토리(이미지)와 꾸미기 설정(좌표)을 합친 결과다. */
export interface StickerSprite extends DecorPlacement {
  imageUrl: string
}

/** 새로 장착했을 때의 기본 배치 — 백엔드 DecorService의 기본값과 맞춰 둔다. */
export const DEFAULT_PLACEMENT = { x: 0.78, y: 0.2, scale: 0.22 } as const
export const MIN_SCALE = 0.05
export const MAX_SCALE = 1

/**
 * 스티커가 이보다 작아지지 않게 하는 하한(프레임 픽셀 기준).
 * 더 작아지면 화면에서 무엇인지 알아볼 수 없고, 끌어서 고르기도 어렵다.
 */
export const MIN_SIZE_PX = 24

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))

/**
 * 프레임 크기(px)에서 스티커가 차지할 너비(px). 높이는 이미지 비율을 따른다.
 *
 * naturalWidth를 주면 <b>원본 이미지보다 크게 그리지 않는다</b> — 픽셀아트를 늘리면 뭉개지고,
 * 없던 해상도가 생기지도 않는다. 원본이 하한(MIN_SIZE_PX)보다도 작으면 원본 크기가 상한이자 하한이다.
 */
export function spriteWidth(
  frameWidth: number,
  frameHeight: number,
  scale: number,
  naturalWidth?: number,
): number {
  const raw = Math.min(frameWidth, frameHeight) * clampScale(scale)
  if (!naturalWidth || naturalWidth <= 0) {
    return raw
  }
  const min = Math.min(MIN_SIZE_PX, naturalWidth)
  return Math.min(Math.max(raw, min), naturalWidth)
}

/**
 * 이 이미지에 허용되는 scale 범위 — 편집 슬라이더의 min·max로 쓴다.
 * 상한은 원본 크기, 하한은 MIN_SIZE_PX를 프레임 기준 비율로 환산한 값이다.
 */
export function scaleLimits(
  frameWidth: number,
  frameHeight: number,
  naturalWidth: number,
): { min: number; max: number } {
  const shortSide = Math.min(frameWidth, frameHeight)
  if (!shortSide || !naturalWidth) {
    return { min: MIN_SCALE, max: MAX_SCALE }
  }
  const max = Math.min(MAX_SCALE, naturalWidth / shortSide)
  return { min: Math.min(MIN_SIZE_PX / shortSide, max), max }
}

// ── 이미지 로더 ────────────────────────────────────────────────
// 원본 크기(naturalWidth)로 확대 상한을 걸어야 해서, 주소별로 한 번만 로드해 캐시한다.
const cache = new Map<string, HTMLImageElement>()

/** 로드가 끝난 이미지만 돌려준다(로딩 중이면 undefined). */
export function getLoadedImage(url: string): HTMLImageElement | undefined {
  const img = cache.get(url)
  return img?.complete && img.naturalWidth > 0 ? img : undefined
}

/** 아직 없으면 로드를 시작한다(멱등). 실패한 주소는 다시 시도하지 않는다. */
export function preloadImage(url: string): void {
  if (!url || cache.has(url)) return
  const img = new Image()
  img.src = url
  cache.set(url, img)
}

export function preloadSprites(sprites: StickerSprite[]): void {
  sprites.forEach((s) => preloadImage(s.imageUrl))
}
