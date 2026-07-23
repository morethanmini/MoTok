import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const gameResultRoutes: RouteRecordRaw[] = [
  {
    path: '/result',
    name: RouteName.GameResult,
    component: () => import('./GameResultView.vue'),
    // ?game=...&room=...
    meta: { requiresAuth: true },
  },
]
