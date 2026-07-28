import type { RouteRecordRaw } from 'vue-router'

/**
 * 캐치캐치리듬 개발 플레이 라우트 — 방·서버 없이 게임만 돌려 보는 용도.
 * 카탈로그·메뉴 어디에도 노출하지 않는다(주소를 아는 사람만 들어온다).
 */
export const catchRhythmRoutes: RouteRecordRaw[] = [
  {
    path: '/dev/catch-rhythm',
    name: 'dev-catch-rhythm',
    component: () => import('@/features/games/catch-rhythm/dev/CatchRhythmDevView.vue'),
  },
]
