import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const gamesCatalogRoutes: RouteRecordRaw[] = [
  {
    path: '/games',
    name: RouteName.GamesCatalog,
    component: () => import('./GamesCatalogView.vue'),
  },
]
