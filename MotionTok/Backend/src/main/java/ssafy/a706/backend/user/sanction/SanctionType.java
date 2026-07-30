package ssafy.a706.backend.user.sanction;

/**
 * 제재 이력의 종류. 부과와 해제가 각각 한 줄로 쌓이는 append-only 이력이다.
 *
 * <p>기간 정지와 영구 정지를 나누는 기준은 <b>스스로 풀리는지</b>다. SUSPEND는 Redis TTL이
 * 만료되면 끝나고, BAN은 관리자가 UNBAN하지 않으면 끝나지 않아 상태 원천이
 * {@code users.status=BANNED}(RDB)다.</p>
 */
public enum SanctionType {
    WARN,      // 경고 — 접근을 막지 않는다. 당사자에게 전달되는 것이 곧 제재의 실행이다.
    SUSPEND,   // 기간 정지 부과
    RELEASE,   // 관리자가 기간 만료 전에 수동 해제
    BAN,       // 영구 정지 부과
    UNBAN      // 영구 정지 해제(오판 정정)
}
