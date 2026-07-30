import type { RouteRecordRaw } from 'vue-router'
import { RouteName } from '@/router/routeNames'

/**
 * 게임⑤ 낚시 개발 도구 라우트 (S15P11A706-10).
 * 낚시 랩은 개발 전용 — 프로덕션 빌드에서는 빈 배열이라 등록되지 않는다.
 */
export const fishingRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/fishing-lab',
        name: RouteName.DevFishingLab,
        component: () => import('./FishingLabView.vue'),
      },
      {
        path: '/dev/fishing-game',
        name: RouteName.DevFishingGame,
        component: () => import('./FishingGameView.vue'),
      },
      /*
       * 정식 화면을 방 없이 혼자 확인하는 자리 (게임④ /dev/body-fit-game과 같은 방식).
       * video prop이 없으면 FishingGame이 직접 카메라를 열기 때문에 래퍼가 필요 없다.
       */
      {
        path: '/dev/fishing-play',
        name: RouteName.DevFishingPlay,
        component: () => import('./FishingGame.vue'),
      },
    ]
  : []
