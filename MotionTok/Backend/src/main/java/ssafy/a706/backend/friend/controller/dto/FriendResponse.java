package ssafy.a706.backend.friend.controller.dto;

import ssafy.a706.backend.presence.model.PresenceSnapshot;

/**
 * API 명세 §6 Friend. presence·currentRoomId는 Redis presence:{userId}에서 온다.
 * 하트비트가 끊긴 친구는 키가 없어 OFFLINE으로 내려간다.
 *
 * <p>avatarUrl을 여기 싣는 이유 — 로비 친구 목록이 얼굴 사진을 그린다. 목록은 이미 User 엔티티를
 * 한 번에 읽고 있으므로(FriendService.listFriends) 추가 조회가 없다. 친구 수만큼
 * {@code GET /users/{id}}를 부르는 대안은 N+1이라 쓰지 않는다.</p>
 *
 * <p>마지막 접속 시각은 여기 싣지 않는다(-179). 프로필 모달에서만 보여주기로 해서
 * {@code PublicUserProfileResponse}로 옮겼다 — 목록에 두면 아무도 안 쓰는 필드가 된다.</p>
 */
public record FriendResponse(
        Long userId,
        String nickname,
        String presence,
        String currentRoomId,
        String avatarUrl
) {

    public static FriendResponse of(Long userId, String nickname, String avatarUrl, PresenceSnapshot presence) {
        return new FriendResponse(userId, nickname, presence.state().name(), presence.roomId(), avatarUrl);
    }
}
