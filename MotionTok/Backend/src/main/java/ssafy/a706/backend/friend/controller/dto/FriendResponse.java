package ssafy.a706.backend.friend.controller.dto;

import ssafy.a706.backend.presence.model.PresenceSnapshot;

import java.time.LocalDateTime;

/**
 * API 명세 §6 Friend. presence·currentRoomId는 Redis presence:{userId}에서 온다.
 * 하트비트가 끊긴 친구는 키가 없어 OFFLINE으로 내려간다.
 *
 * <p>avatarUrl을 여기 싣는 이유 — 로비 친구 목록이 얼굴 사진을 그린다. 목록은 이미 User 엔티티를
 * 한 번에 읽고 있으므로(FriendService.listFriends) 추가 조회가 없다. 친구 수만큼
 * {@code GET /users/{id}}를 부르는 대안은 N+1이라 쓰지 않는다.</p>
 */
public record FriendResponse(
        Long userId,
        String nickname,
        String presence,
        String currentRoomId,
        String avatarUrl,
        LocalDateTime lastSeenAt
) {

    /**
     * @param lastSeenAt 마지막 접속 종료 시각(-179). <b>오프라인일 때만 의미가 있다</b> —
     *                   온라인 친구의 값은 직전 접속의 종료 시각이라 지금과 무관하다.
     *                   배포 이후 한 번도 정산되지 않은 회원은 null.
     */
    public static FriendResponse of(Long userId, String nickname, String avatarUrl,
                                    PresenceSnapshot presence, LocalDateTime lastSeenAt) {
        return new FriendResponse(
                userId, nickname, presence.state().name(), presence.roomId(), avatarUrl, lastSeenAt);
    }
}
