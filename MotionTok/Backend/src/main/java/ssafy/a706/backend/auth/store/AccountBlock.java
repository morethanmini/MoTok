package ssafy.a706.backend.auth.store;

/**
 * 지금 이 계정이 막혀 있는 이유. 요청 경로가 어떤 오류로 끊을지 고르는 데 쓴다.
 *
 * <p>둘을 한 열거형으로 두는 이유 — 호출부(필터·STOMP 인터셉터·로그인)는 "막혔나"를 <b>한 번</b>
 * 물어보고 그 결과로 분기해야 한다. 정지와 영구정지를 따로 물으면 인증 경로마다 Redis 왕복이 둘이 되고,
 * 더 나쁘게는 한쪽만 확인하는 경로가 생긴다.</p>
 */
public enum AccountBlock {

    /** 막혀 있지 않다. */
    NONE,

    /** 기간 정지 — TTL이 만료되면 스스로 풀린다. */
    SUSPENDED,

    /** 영구 정지 — 관리자가 해제하지 않으면 풀리지 않는다. users.status=BANNED가 원천이다. */
    BANNED;

    public boolean isBlocked() {
        return this != NONE;
    }
}
