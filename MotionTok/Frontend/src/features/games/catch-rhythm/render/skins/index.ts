/** 스킨 레지스트리 — 새 스킨은 파일 추가 + 여기 한 줄이면 끝. */

import type { CatchSkin } from './types'
import { catCandySkin } from './catCandy'
import { debugSkin } from './debug'

export const SKINS: Record<string, CatchSkin> = {
  [catCandySkin.id]: catCandySkin,
  [debugSkin.id]: debugSkin,
}

export const DEFAULT_SKIN_ID = catCandySkin.id

export function resolveSkin(id: string | undefined): CatchSkin {
  return (id && SKINS[id]) || SKINS[DEFAULT_SKIN_ID]!
}

export type { CatchSkin }
