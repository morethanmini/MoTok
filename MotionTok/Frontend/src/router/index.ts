import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { routes } from './routes'
import { RouteName } from './routeNames'
import { readAccessClaims } from '@/api/token'
import { askLogin } from '@/composables/useLoginRequired'
import { useSessionStore } from '@/stores/session'

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
 *
 * 만료된 회원 토큰은 아래 beforeEach가 먼저 돌린 세션 복원 단계에서 재발급되므로,
 * 여기까지 만료 상태로 오는 건 '재발급도 실패한' 경우다. 그 안내는 세션 만료 이벤트가 맡는다(App.vue).
 */
export function requireMember(to: RouteLocationNormalized) {
  if (!to.meta.requiresMember) return true
  if (readAccessClaims()?.type === 'member') return true

  askLogin('이 페이지는 로그인 후 이용할 수 있어요.')
  return { name: RouteName.Start }
}

/**
 * 관리자 전용 라우트(meta.requiresAdmin) 가드. requiresMember를 통과한 뒤 역할까지 좁힌다.
 * 판단 근거는 세션 복원 시 서버가 내려준 프로필(GET /users/me)의 role — 토큰에는 role이 없다.
 * 화면 노출용 판정일 뿐, 실제 관리자 API 권한은 서버가 검증한다(SecurityConfig: /api/admin/** hasRole('ADMIN')).
 */
function requireAdmin(to: RouteLocationNormalized) {
  if (!to.meta.requiresAdmin) return true
  const session = useSessionStore()
  if (session.profile?.role === 'ADMIN') return true
  return { name: RouteName.Lobby } // 권한 없는 회원 — 기본 화면으로 돌려보낸다
}

/**
 * 세션만 있으면 되는 라우트(meta.requiresAuth) 가드.
 * 기기 설정 → 대기실 → 결과는 회원 멀티플레이와 게스트 1인 플레이가 함께 쓰는 구간이라
 * 회원으로 좁히지 않고 '유효한 세션'만 요구한다. 반대로 로비·상점처럼 회원만의 화면은 requiresMember다.
 */
function requireAuth(to: RouteLocationNormalized) {
  if (!to.meta.requiresAuth) return true
  if (readAccessClaims()) return true

  askLogin('로그인하거나 게스트로 시작한 뒤 이용할 수 있어요.')
  return { name: RouteName.Start }
}

/**
 * 화면을 그리기 전에 세션을 복원한다.
 * 새로고침 직후엔 스토어가 비어 있어 "토큰은 있는데 프로필이 없는" 상태가 되는데,
 * 그대로 두면 헤더가 기본값을 그리고(P1) 만료된 세션인데도 로비에 남는다.
 * 복원은 단일 비행이라 라우팅마다 비용이 들지 않는다.
 */
router.beforeEach(async (to) => {
  const session = useSessionStore()
  await session.ensureRestored()

  // 소셜 최초 로그인 — 닉네임을 정하기 전에는 설정 화면 밖으로 나가지 못한다(-22).
  if (session.nicknamePending && to.name !== RouteName.NicknameSetup) {
    return { name: RouteName.NicknameSetup }
  }

  const memberCheck = requireMember(to)
  if (memberCheck !== true) return memberCheck
  const adminCheck = requireAdmin(to)
  if (adminCheck !== true) return adminCheck
  return requireAuth(to)
})

export default router
