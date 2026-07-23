/**
 * 게스트에게 한 게임이 끝날 때마다 띄우는 회원가입/로그인 유도 팝업의 전역 상태 (-109).
 *
 * 게임 구현이 아직 없어서 "게임이 끝났다"는 신호를 낼 곳이 없다.
 * 그래서 트리거(promptGuestSignup)만 먼저 만들어 두고, 지금은 결과 화면 진입 시점에 물려 둔다.
 * 게임 세션이 붙으면 종료 처리에서 이 함수 한 줄만 부르면 된다.
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
