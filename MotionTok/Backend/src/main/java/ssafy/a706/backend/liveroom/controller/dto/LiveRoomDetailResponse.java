package ssafy.a706.backend.liveroom.controller.dto;

import ssafy.a706.backend.liveroom.model.LiveRoom;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;

import java.util.List;

public record LiveRoomDetailResponse(
        String roomId,
        String title,
        String visibility,
        int maxPlayers,
        int participantCount,
        String status,
        String hostUserId,
        String inviteCode,
        List<MemberView> members
) {
    public record MemberView(String userId, String displayName, boolean guest) {
        static MemberView from(LiveRoomMemberValue m) {
            return new MemberView(m.userId(), m.displayName(), m.guest());
        }
    }

    public static LiveRoomDetailResponse from(LiveRoom room) {
        return new LiveRoomDetailResponse(
                room.roomId(),
                room.title(),
                room.visibility().name(),
                room.maxPlayers(),
                room.participantCount(),
                room.status(),
                room.hostUserId(),
                room.inviteCode(),
                room.members().stream().map(MemberView::from).toList()
        );
    }
}
