/**
 * 인증 계층에서 발생하는 전역 이벤트.
 *
 * http.ts(하위 계층)가 라우터·스토어(상위 계층)를 직접 부르면 순환 참조가 되므로,
 * "세션이 끊겼다"는 사실만 여기로 흘려보내고 App.vue가 받아서 안내·이동을 처리한다.
 */
type Handler = () => void

const sessionExpiredHandlers = new Set<Handler>()

/** 구독 해제 함수를 돌려준다. */
export function onSessionExpired(handler: Handler): () => void {
  sessionExpiredHandlers.add(handler)
  return () => sessionExpiredHandlers.delete(handler)
}

/**
 * Refresh까지 실패해 더 이상 세션을 이어갈 수 없을 때 호출한다.
 * 한 번의 화면 전환에서 여러 요청이 동시에 실패해도 안내가 여러 번 뜨지 않도록 호출부(http.ts)에서 한 번만 낸다.
 */
export function emitSessionExpired() {
  for (const handler of sessionExpiredHandlers) handler()
}
