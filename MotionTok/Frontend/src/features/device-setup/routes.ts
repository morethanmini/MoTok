import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const deviceSetupRoutes: RouteRecordRaw[] = [
  {
    path: '/device-setup',
    name: RouteName.DeviceSetup,
    component: () => import('./DeviceSetupView.vue'),
    // ?game=...&room=...
  },
]
