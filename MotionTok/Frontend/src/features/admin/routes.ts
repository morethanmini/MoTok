import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const adminRoutes: RouteRecordRaw[] = [
  {
    path: '/admin',
    name: RouteName.Admin,
    component: () => import('./AdminView.vue'),
    // TODO: meta.requiresRole = 'ADMIN' + 라우터 가드에서 검증
  },
]
