package ssafy.a706.backend.liveroom.controller.dto;

/** /topic/rooms/{roomId}/members로 방송되는 퇴장 알림(S15P11A706-71). */
public record LiveRoomMemberLeftEvent(
        String userId,
        String displayName,
        int participantCount
) {
}
