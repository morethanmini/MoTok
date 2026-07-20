import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const friendsRoutes: RouteRecordRaw[] = [
  {
    path: '/friends',
    name: RouteName.Friends,
    component: () => import('./FriendsView.vue'),
  },
]
