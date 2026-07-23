import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const deviceSetupRoutes: RouteRecordRaw[] = [
  {
    path: '/device-setup',
    name: RouteName.DeviceSetup,
    component: () => import('./DeviceSetupView.vue'),
    // ?game=...&room=...
    // 회원 멀티플레이·게스트 1인 플레이가 함께 지나는 구간이라 세션만 요구한다.
    meta: { requiresAuth: true },
  },
]
