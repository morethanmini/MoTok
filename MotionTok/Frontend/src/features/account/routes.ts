import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const accountRoutes: RouteRecordRaw[] = [
  {
    path: '/me',
    name: RouteName.MyPage,
    component: () => import('./MyPageView.vue'),
  },
  {
    path: '/me/settings',
    name: RouteName.AccountSettings,
    component: () => import('./AccountSettingsView.vue'),
  },
]
