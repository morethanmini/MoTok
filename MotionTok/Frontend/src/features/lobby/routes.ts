import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const lobbyRoutes: RouteRecordRaw[] = [
  {
    path: '/lobby',
    name: RouteName.Lobby,
    component: () => import('./LobbyView.vue'),
  },
]
