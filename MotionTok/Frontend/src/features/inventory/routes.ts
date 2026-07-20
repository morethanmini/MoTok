import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const inventoryRoutes: RouteRecordRaw[] = [
  {
    path: '/inventory',
    name: RouteName.Inventory,
    component: () => import('./InventoryView.vue'),
  },
]
