package ssafy.a706.backend.friend.controller.dto;

/**
 * API 명세 §6 Friend. presence는 Redis presence:{userId} 기반이지만 그 키가 아직 미구현이라
 * 지금은 항상 OFFLINE으로 내려간다(프론트는 배지만 회색으로 표시 — 친구 목록 기능 자체는 영향 없음).
 * 프레즌스 구현 시 여기 값만 채워지면 프론트 변경 없이 살아난다.
 */
public record FriendResponse(
        Long userId,
        String nickname,
        String presence,
        String currentRoomId
) {

    private static final String PRESENCE_OFFLINE = "OFFLINE";

    public static FriendResponse offline(Long userId, String nickname) {
        return new FriendResponse(userId, nickname, PRESENCE_OFFLINE, null);
    }
}
