/**
 * 단일 세션 — 같은 계정으로 다른 곳에서 로그인하면 이 세션이 밀려난다.
 *
 * 서버가 개인 큐로 `SESSION_DISPLACED`를 보내고 잠시 뒤 웹소켓을 끊는다(SingleSessionPolicy).
 * 안내 없이 끊기면 "갑자기 실시간이 죽었다"로만 보이므로, 알림을 받는 즉시 세션 만료와 같은
 * 경로로 흘려보내 안내를 띄우고 로그아웃시킨다(App.vue).
 *
 * 로비가 아니라 앱 셸에서 켠다 — 게임 중이든 설정 화면이든 떠야 하는 안내이기 때문이다.
 * (로비도 같은 큐를 구독하지만 초대·친구 요청만 본다. subscribeGlobal은 목적지 하나에
 * 여러 구독자를 허용하므로 서로를 밀어내지 않는다.)
 */
import { emitSessionExpired, isOwnLoginRecent } from '@/api/authEvents'
import type { UserNotification } from '@/api/types'
import { isMemberSession, subscribeGlobal } from './useGlobalStomp'

const NOTIFICATIONS_QUEUE = '/user/queue/notifications'

export function useSessionDisplaced() {
  return subscribeGlobal(NOTIFICATIONS_QUEUE, (body) => {
    // 게스트는 계정이 없어 밀려날 일이 없다.
    if (!isMemberSession()) return
    try {
      const notification = JSON.parse(body) as UserNotification
      if (notification.type !== 'SESSION_DISPLACED') return
      // 나를 밀어낸 로그인이 곧 나라면 무시한다 — 판단 근거는 authEvents가 갖고 있다.
      if (isOwnLoginRecent()) return
      emitSessionExpired('displaced')
    } catch {
      // 형식 오류 프레임은 무시 — 같은 큐로 다른 도메인 알림도 흐른다.
    }
  })
}
