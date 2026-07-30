/**
 * 인증 계층에서 발생하는 전역 이벤트.
 *
 * http.ts(하위 계층)가 라우터·스토어(상위 계층)를 직접 부르면 순환 참조가 되므로,
 * "세션이 끊겼다"는 사실만 여기로 흘려보내고 App.vue가 받아서 안내·이동을 처리한다.
 */
/**
 * 세션이 끝난 이유. 안내 문구가 갈린다 —
 * 회원은 "다시 로그인해 주세요", 게스트는 "로그인하면 더 즐길 수 있어요"(회원 전환 유도),
 * displaced는 "다른 곳에서 로그인했어요"(본인이 아니면 비밀번호를 바꿔야 하는 상황).
 */
export type SessionEndReason = 'member' | 'guest' | 'displaced'

type Handler = (reason: SessionEndReason) => void

/** 계정이 막힌 이유. 기간 정지와 영구 정지는 안내 문구가 달라야 해서 함께 전달한다. */
export type AccountBlockKind = 'SUSPENDED' | 'BANNED'
type BlockHandler = (kind: AccountBlockKind) => void

const sessionExpiredHandlers = new Set<Handler>()
const accountBlockedHandlers = new Set<BlockHandler>()

/** 구독 해제 함수를 돌려준다. */
export function onSessionExpired(handler: Handler): () => void {
  sessionExpiredHandlers.add(handler)
  return () => sessionExpiredHandlers.delete(handler)
}

/**
 * 계정이 제재돼 세션을 이어갈 수 없을 때(-105).
 *
 * <p><b>{@link onSessionExpired}와 합치지 않는 이유.</b> `SessionEndReason`은 "세션이 왜 끝났나"의
 * 값들이고 셋 다 <b>다시 로그인하면 이어진다</b> — 만료·게스트 종료·다른 곳 로그인. 제재는 축이
 * 다르다: 계정 자체가 막혀 로그인이 성립하지 않는다. 같은 열거형에 넣으면 "다시 로그인" 안내를
 * 공유하는 값들 사이에 그럴 수 없는 값이 섞인다.</p>
 *
 * <p>두 경로에서 들어온다: REST 403(AUTH_ACCOUNT_SUSPENDED·AUTH_ACCOUNT_BANNED, http.ts)와
 * 웹소켓 1008 종료 프레임(useGlobalStomp). 어느 쪽이 먼저 도착할지는 사용자가 뭘 하던 중이었는지에 달렸다.</p>
 */
export function onAccountBlocked(handler: BlockHandler): () => void {
  accountBlockedHandlers.add(handler)
  return () => accountBlockedHandlers.delete(handler)
}

export function emitAccountBlocked(kind: AccountBlockKind) {
  for (const handler of accountBlockedHandlers) handler(kind)
}

/**
 * 더 이상 세션을 이어갈 수 없을 때 호출한다 — 회원은 Refresh까지 실패했을 때,
 * 게스트는 갱신 수단이 없어 액세스 토큰이 만료된 순간(refreshScheduler).
 * 한 번의 화면 전환에서 여러 요청이 동시에 실패해도 안내가 여러 번 뜨지 않도록 호출부에서 한 번만 낸다.
 */
export function emitSessionExpired(reason: SessionEndReason = 'member') {
  for (const handler of sessionExpiredHandlers) handler(reason)
}

// ── 내 로그인이 만든 밀어내기인가 ────────────────────────────────────────
// 서버는 밀어내기 알림을 sid가 아니라 userId로 보낸다. 그래서 이미 로그인한 채로 같은 탭에서
// 다시 로그인하면 아직 열려 있는 내 소켓에도 그 알림이 온다 — 그대로 받으면 로그인하자마자
// "다른 곳에서 로그인했어요"를 보고 튕긴다.
//
// 종전에는 액세스 토큰의 iat이 최근인지로 걸렀는데 두 군데서 샜다. (1) 알림 프레임이 로그인
// 응답보다 먼저 도착하면 그 시점의 토큰은 아직 '옛 것'이라 iat이 오래돼 걸러지지 않는다 —
// 로그인이 한 번씩 튕기던 원인이다. (2) iat은 서버 시계 기준 초 단위라 클라이언트 시계와
// 어긋나면 창이 밀린다. 그래서 요청을 보내기 '전에' 클라이언트가 스스로 남기는 표시로 바꾼다 —
// 도착 순서와 시계 오차 어느 쪽에도 기대지 않는다.

/** 로그인 요청을 보낸 시각(클라이언트 시계). 0이면 이 탭에서 로그인을 시도한 적이 없다. */
let ownLoginStartedAt = 0

/** 이 창 안에 도착한 밀어내기 알림은 내 로그인이 부른 것으로 본다. */
const OWN_LOGIN_WINDOW_MS = 10_000

/** 로그인·소셜 로그인 요청을 보내기 직전에 부른다(응답을 기다리기 전이어야 한다). */
export function markOwnLoginStarted() {
  ownLoginStartedAt = Date.now()
}

/** 방금 내가 로그인했는가 — 밀어내기 알림을 무시할지 판단하는 기준. */
export function isOwnLoginRecent(): boolean {
  return Date.now() - ownLoginStartedAt < OWN_LOGIN_WINDOW_MS
}
