import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const unsupportedRoutes: RouteRecordRaw[] = [
  {
    path: '/unsupported',
    name: RouteName.Unsupported,
    component: () => import('./UnsupportedView.vue'),
  },
]
