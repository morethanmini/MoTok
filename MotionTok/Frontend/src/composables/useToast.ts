/**
 * 가벼운 토스트 헬퍼 (화면 로컬). flash(msg)로 잠깐 띄우고 자동으로 사라집니다.
 * 여러 화면에서 동일 패턴이라 컴포저블로 추출.
 */
import { onBeforeUnmount, ref } from 'vue'

export function useToast(duration = 2200) {
  const message = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined

  function flash(msg: string) {
    message.value = msg
    clearTimeout(timer)
    timer = setTimeout(() => (message.value = ''), duration)
  }

  onBeforeUnmount(() => clearTimeout(timer))

  return { message, flash }
}
