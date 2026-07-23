/**
 * '로그인이 필요해요' 안내 모달의 전역 상태.
 * 라우터 가드처럼 컴포넌트 밖에서도 띄워야 하므로 모듈 싱글턴으로 두고, App.vue가 렌더한다.
 */
import { ref } from 'vue'

const message = ref('')

/** 모달을 띄운다(라우터 가드 등에서 호출). */
export function askLogin(msg = '로그인이 필요한 페이지예요.') {
  message.value = msg
}

export function useLoginRequired() {
  return { message, close: () => (message.value = '') }
}
