import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

/**
 * 게임④ 그대로 멈춰라 개발 도구 라우트 (S15P11A706-136).
 * 아바타 랩은 개발 전용 — 프로덕션 빌드에서는 빈 배열이라 등록되지 않는다.
 */
export const bodyFitRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/avatar-lab',
        name: RouteName.DevAvatarLab,
        component: () => import('./AvatarLabView.vue'),
      },
      {
        path: '/dev/wall-lab',
        name: RouteName.DevWallLab,
        component: () => import('./WallLabView.vue'),
      },
      {
        path: '/dev/body-fit-game',
        name: RouteName.DevBodyFitGame,
        component: () => import('./BodyFitGame.vue'),
      },
    ]
  : []
