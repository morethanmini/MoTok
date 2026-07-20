package ssafy.a706.backend.liveroom.model;

import java.util.List;

/** Redis에서 읽어온 방 상태를 재구성한 도메인 표현. */
public record LiveRoom(
        String roomId,
        String title,
        LiveRoomVisibility visibility,
        int maxPlayers,
        String status,
        String hostUserId,
        String hostDisplayName,
        long createdAt,
        String inviteCode,
        String password,
        List<LiveRoomMemberValue> members
) {
    public int participantCount() {
        return members.size();
    }

    public boolean hasPassword() {
        return password != null && !password.isBlank();
    }
}
