/** 스킨 레지스트리 — 새 스킨은 파일 추가 + 여기 한 줄이면 끝. */

import type { FishingSkin } from '../types'
import { debugSkin } from './debug'

export const SKINS: Record<string, FishingSkin> = {
  [debugSkin.id]: debugSkin,
}

/** 계측 화면이 기본이다 — 정식 스킨이 들어오면 여기를 옮긴다 */
export const DEFAULT_SKIN_ID = debugSkin.id

export function resolveSkin(id: string | undefined): FishingSkin {
  return (id && SKINS[id]) || SKINS[DEFAULT_SKIN_ID]!
}

export type { FishingSkin }
