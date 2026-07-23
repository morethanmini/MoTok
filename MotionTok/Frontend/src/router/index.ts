import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { routes } from './routes'
import { RouteName } from './routeNames'
import { readAccessClaims } from '@/api/token'
import { askLogin } from '@/composables/useLoginRequired'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

/**
 * 회원 전용 라우트(meta.requiresMember) 가드.
 *
 * 주소창으로 직접 들어와도 막히도록 세션 스토어의 role(인메모리 — 새로고침 시 사라짐) 대신
 * 저장된 액세스 토큰을 판단 근거로 삼는다.
 *   - 토큰 없음 / 만료 / 형식 오류 → 비로그인
 *   - type=guest                  → 게스트(회원 전용 화면 접근 불가)
 *   - type=member                 → 통과
 * 클라이언트 판정은 화면 노출용이고, 실제 데이터 권한은 서버가 다시 검증한다
 * (SecurityConfig: /api/users/** hasRole('USER')).
 */
export function requireMember(to: RouteLocationNormalized) {
  if (!to.meta.requiresMember) return true
  if (readAccessClaims()?.type === 'member') return true

  askLogin('이 페이지는 로그인 후 이용할 수 있어요.')
  return { name: RouteName.Start }
}

router.beforeEach(requireMember)

export default router
