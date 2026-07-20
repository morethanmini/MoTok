import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const authRoutes: RouteRecordRaw[] = [
  {
    path: '/auth',
    name: RouteName.Auth,
    component: () => import('./AuthView.vue'),
    // ?mode=login | signup
  },
]
