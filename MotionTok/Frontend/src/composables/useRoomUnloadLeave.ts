/**
 * 방(장치설정·게임룸)에 입장한 채로 문서가 통째로 내려가는 이탈을 처리한다.
 *
 * SPA 라우팅 이탈(나가기 버튼·다른 탭 이동)은 각 뷰의 onBeforeRouteLeave가 퇴장을 통보하지만,
 * 탭 닫기·주소창 직접 이동·새로고침은 라우터를 거치지 않아 방 인원 카운트가 새는 문제가 있었다.
 *  - pagehide: keepalive 퇴장 통보(roomsApi.leaveOnUnload) — 인원 카운트가 줄어든다.
 *  - pageshow(persisted): bfcache로 방 화면이 그대로 복원된 경우 — 이미 퇴장했으므로
 *    방으로 되돌리지 않고 로비로 보낸다(뒤로가기 복귀 차단).
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { roomsApi } from '@/api'

export function useRoomUnloadLeave(getRoomId: () => string | null | undefined) {
  const router = useRouter()

  function onPageHide() {
    const roomId = getRoomId()
    if (roomId) roomsApi.leaveOnUnload(roomId)
  }

  function onPageShow(e: PageTransitionEvent) {
    if (e.persisted) void router.replace({ name: RouteName.Lobby })
  }

  onMounted(() => {
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
  })
}
