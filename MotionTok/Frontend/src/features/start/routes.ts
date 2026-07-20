import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const startRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    name: RouteName.Start,
    component: () => import('./StartView.vue'),
  },
]
