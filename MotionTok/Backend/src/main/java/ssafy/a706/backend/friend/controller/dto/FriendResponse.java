package ssafy.a706.backend.friend.controller.dto;

import ssafy.a706.backend.presence.model.PresenceSnapshot;

/**
 * API 명세 §6 Friend. presence·currentRoomId는 Redis presence:{userId}에서 온다.
 * 하트비트가 끊긴 친구는 키가 없어 OFFLINE으로 내려간다.
 */
public record FriendResponse(
        Long userId,
        String nickname,
        String presence,
        String currentRoomId
) {

    public static FriendResponse of(Long userId, String nickname, PresenceSnapshot presence) {
        return new FriendResponse(userId, nickname, presence.state().name(), presence.roomId());
    }
}
