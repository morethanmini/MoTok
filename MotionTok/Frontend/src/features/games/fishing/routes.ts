import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

/**
 * 게임⑤ 낚시 개발 도구 라우트 (S15P11A706-10).
 * 낚시 랩은 개발 전용 — 프로덕션 빌드에서는 빈 배열이라 등록되지 않는다.
 */
export const fishingRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/fishing-lab',
        name: RouteName.DevFishingLab,
        component: () => import('./FishingLabView.vue'),
      },
      {
        path: '/dev/fishing-game',
        name: RouteName.DevFishingGame,
        component: () => import('./FishingGameView.vue'),
      },
    ]
  : []
