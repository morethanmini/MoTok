import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const lobbyRoutes: RouteRecordRaw[] = [
  {
    path: '/lobby',
    name: RouteName.Lobby,
    component: () => import('./LobbyView.vue'),
    // 로비부터가 회원 플로우 — 게스트는 /games로 분리된다(-109).
    meta: { requiresMember: true },
  },
]
