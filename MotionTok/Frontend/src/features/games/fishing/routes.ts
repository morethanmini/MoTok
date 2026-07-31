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
      /*
       * 조준은 유일하게 어깨너비 정규화를 안 쓰는 판정이라 별도 랩으로 뺐다.
       * 큰 랩(FishingLabView)은 어깨너비·크랭크·캐스팅 3종을 이미 담고 있어 수술 위험이 크다.
       */
      {
        path: '/dev/fishing-aim-lab',
        name: RouteName.DevFishingAimLab,
        component: () => import('./AimLabView.vue'),
      },
    ]
  : []
