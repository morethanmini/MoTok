import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const adminRoutes: RouteRecordRaw[] = [
  {
    path: '/admin',
    name: RouteName.Admin,
    component: () => import('./AdminView.vue'),
    meta: { requiresMember: true, requiresAdmin: true },
  },
]
