/** 스킨 레지스트리 — 새 스킨은 파일 추가 + 여기 한 줄이면 끝. */

import type { FishingSkin } from '../types'
import { cozySkin } from './cozy'
import { debugSkin } from './debug'

export const SKINS: Record<string, FishingSkin> = {
  [cozySkin.id]: cozySkin,
  [debugSkin.id]: debugSkin,
}

export const DEFAULT_SKIN_ID = cozySkin.id

export function resolveSkin(id: string | undefined): FishingSkin {
  return (id && SKINS[id]) || SKINS[DEFAULT_SKIN_ID]!
}

export type { FishingSkin }
