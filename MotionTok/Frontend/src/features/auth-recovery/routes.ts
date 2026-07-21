import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const authRecoveryRoutes: RouteRecordRaw[] = [
  {
    path: '/auth/find-id',
    name: RouteName.FindId,
    component: () => import('./FindIdView.vue'),
  },
  {
    path: '/auth/reset-password',
    name: RouteName.ResetPassword,
    component: () => import('./ResetPasswordView.vue'),
    // ?token=... (메일 링크)
  },
]
