import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const gameRoomRoutes: RouteRecordRaw[] = [
  {
    path: '/room',
    name: RouteName.GameRoom,
    component: () => import('./GameRoomView.vue'),
    // ?game=...&room=...&host=1
    meta: { requiresAuth: true },
  },
]
