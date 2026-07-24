import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const adminRoutes: RouteRecordRaw[] = [
  {
    path: '/admin',
    name: RouteName.Admin,
    component: () => import('./AdminView.vue'),
    // role claim 기반 ADMIN 가드 (v0.2.16, -133) — requireAdmin이 검증한다.
    meta: { requiresMember: true, requiresAdmin: true },
  },
]
