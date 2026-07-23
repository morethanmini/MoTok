import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const authRoutes: RouteRecordRaw[] = [
  {
    path: '/auth',
    name: RouteName.Auth,
    component: () => import('./AuthView.vue'),
    // ?mode=login | signup
  },
  {
    // 소셜 최초 로그인 직후에만 들르는 화면 — 토큰은 이미 발급된 상태라 회원 전용이다(-22).
    path: '/auth/nickname',
    name: RouteName.NicknameSetup,
    component: () => import('./NicknameSetupView.vue'),
    meta: { requiresMember: true },
  },
]
