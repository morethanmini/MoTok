/**
 * '접근 권한이 없습니다' 안내 모달의 전역 상태.
 * 라우터 가드처럼 컴포넌트 밖에서도 띄워야 하므로 모듈 싱글턴으로 두고, App.vue가 렌더한다.
 */
import { ref } from 'vue'

const message = ref('')

/** 모달을 띄운다(라우터 가드 등에서 호출). */
export function denyAccess(msg = '접근 권한이 없습니다.') {
  message.value = msg
}

export function useAccessDenied() {
  return { message, close: () => (message.value = '') }
}
