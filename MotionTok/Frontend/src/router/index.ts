import { createRouter, createWebHistory } from 'vue-router'
import { routes } from './routes'
import { RouteName } from './routeNames'
import { useSessionStore } from '@/stores/session'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

// 회원 전용 라우트(meta.requiresMember)는 '확정된 게스트'만 차단한다.
// 세션 role은 인메모리라 새로고침 시 null일 수 있는데, 그때는 통과시키고 실제 접근은 백엔드 인증(401/403)이 막는다.
// (게스트를 null로 오인해 회원 새로고침을 막는 오작동을 피하기 위함)
router.beforeEach((to) => {
  if (to.meta.requiresMember && useSessionStore().isGuest) {
    return { name: RouteName.Auth, query: { mode: 'login' } }
  }
})

export default router
