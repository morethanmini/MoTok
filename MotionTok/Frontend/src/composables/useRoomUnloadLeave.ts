/**
 * 방(장치설정·게임룸)에 입장한 채로 문서가 통째로 내려가는 이탈을 처리한다.
 *
 * SPA 라우팅 이탈(나가기 버튼·다른 탭 이동)은 각 뷰의 onBeforeRouteLeave가 퇴장을 통보하지만,
 * 탭 닫기·주소창 직접 이동·새로고침은 라우터를 거치지 않아 방 인원 카운트가 새는 문제가 있었다.
 *  - pagehide: keepalive 퇴장 통보(roomsApi.leaveOnUnload) — {@link Options.unloadLeave} 참고.
 *  - pageshow(persisted): bfcache로 방 화면이 그대로 복원된 경우 — 복원된 화면은 소켓·SFU 연결이
 *    모두 끊겨 있어 그대로 쓸 수 없으므로 방으로 되돌리지 않고 로비로 보낸다(뒤로가기 복귀 차단).
 *    단 게스트는 로비가 회원 전용(requiresMember)이라 "로그인이 필요해요"가 뜨므로 1인 게임 목록으로 보낸다.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import { roomsApi } from '@/api'

interface Options {
  /**
   * pagehide에 퇴장을 통보할지. 기본 true.
   *
   * <p><b>새로고침도 pagehide다.</b> 통보해 버리면 새로고침이 곧 퇴장이 되어, 리로드 후
   * 방 멤버가 아니라는 이유로 로비로 튕기고 혼자 있던 방이면 방까지 사라진다. 그래서
   * 서버가 재실을 따로 추적하는 화면에서는 꺼야 한다 — 게임룸은 방 채팅 토픽을 구독하므로
   * RoomPresenceTracker가 끊김을 보고 유예(GRACE_MS) 뒤 퇴장시킨다. 탭을 닫으면 그 경로로
   * 정리되고, 새로고침은 유예 안에 다시 구독하므로 재실이 유지된다.</p>
   *
   * <p>반대로 기기 점검 화면은 방 토픽을 구독하지 않아 리퍼의 시야 밖이다 —
   * 여기서 끄면 탭을 닫은 사람이 유령 멤버로 영구히 남는다. 기본값을 true로 두는 이유다.</p>
   */
  unloadLeave?: boolean
}

export function useRoomUnloadLeave(
  getRoomId: () => string | null | undefined,
  { unloadLeave = true }: Options = {},
) {
  const router = useRouter()
  const session = useSessionStore()

  function onPageHide() {
    if (!unloadLeave) return
    const roomId = getRoomId()
    if (roomId) roomsApi.leaveOnUnload(roomId)
  }

  function onPageShow(e: PageTransitionEvent) {
    if (e.persisted) {
      void router.replace({ name: session.isGuest ? RouteName.GamesCatalog : RouteName.Lobby })
    }
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
