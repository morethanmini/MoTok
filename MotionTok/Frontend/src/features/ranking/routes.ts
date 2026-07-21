import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const rankingRoutes: RouteRecordRaw[] = [
  {
    path: '/ranking',
    name: RouteName.Ranking,
    component: () => import('./RankingView.vue'),
  },
]
