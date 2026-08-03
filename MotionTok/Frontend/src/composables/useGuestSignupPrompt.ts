/**
 * 게스트에게 한 게임이 끝날 때마다 띄우는 회원가입/로그인 유도 팝업의 전역 상태 (-109).
 *
 * 게임 구현이 아직 없어서 "게임이 끝났다"는 신호를 낼 곳이 없다.
 * 그래서 트리거(promptGuestSignup)만 먼저 만들어 두고, 지금은 결과 화면 진입 시점에 물려 둔다.
 *
 * ⚠️ 실제 게임 종료(GameRoomView)는 <b>여기를 쓰지 않는다.</b> 이 팝업은 App.vue가 띄우고
 * 버튼을 누르면 그냥 라우팅만 하는데, 방 안에서는 그 이동이 라우터 가드에 걸려
 * "정말 떠나시겠습니까?"가 겹쳐 뜬다. 방은 퇴장 통보까지 맡아야 해서
 * GuestSignupPromptModal을 직접 띄운다(GameRoomView.leaveGuestRoom).
 */
import { ref } from 'vue'

const open = ref(false)

/**
 * 게스트일 때만 호출하세요(호출부에서 session.isGuest 확인).
 * 이미 떠 있으면 다시 띄우지 않는다.
 */
export function promptGuestSignup() {
  open.value = true
}

export function useGuestSignupPrompt() {
  return { open, close: () => (open.value = false) }
}
