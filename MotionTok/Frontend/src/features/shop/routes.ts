import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

export const shopRoutes: RouteRecordRaw[] = [
  {
    path: '/shop',
    name: RouteName.Shop,
    component: () => import('./ShopView.vue'),
  },
  {
    path: '/shop/ai-create',
    name: RouteName.AiItemCreate,
    component: () => import('./AiItemCreateView.vue'),
  },
]
