/**
 * 전체 라우트 취합 지점.
 * 새 화면 추가 시: features/<name>/routes.ts 를 만들고 여기에 import + 스프레드 한 줄만 추가.
 * (각 feature가 자기 라우트를 소유 → 파일 충돌 최소화)
 */
import type { RouteRecordRaw } from 'vue-router'

import { startRoutes } from '@/features/start/routes'
import { authRoutes } from '@/features/auth/routes'
import { lobbyRoutes } from '@/features/lobby/routes'
import { deviceSetupRoutes } from '@/features/device-setup/routes'
import { gameRoomRoutes } from '@/features/game-room/routes'
import { gameResultRoutes } from '@/features/game-result/routes'
import { authRecoveryRoutes } from '@/features/auth-recovery/routes'
import { accountRoutes } from '@/features/account/routes'
import { shopRoutes } from '@/features/shop/routes'
import { inventoryRoutes } from '@/features/inventory/routes'
import { friendsRoutes } from '@/features/friends/routes'
import { rankingRoutes } from '@/features/ranking/routes'
import { gamesCatalogRoutes } from '@/features/games-catalog/routes'
import { adminRoutes } from '@/features/admin/routes'
import { unsupportedRoutes } from '@/features/unsupported/routes'

export const routes: RouteRecordRaw[] = [
  ...startRoutes,
  ...authRoutes,
  ...lobbyRoutes,
  ...deviceSetupRoutes,
  ...gameRoomRoutes,
  ...gameResultRoutes,
  ...authRecoveryRoutes,
  ...accountRoutes,
  ...shopRoutes,
  ...inventoryRoutes,
  ...friendsRoutes,
  ...rankingRoutes,
  ...gamesCatalogRoutes,
  ...adminRoutes,
  ...unsupportedRoutes,
]
