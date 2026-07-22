package ssafy.a706.backend.liveroom.controller.dto;

/** /topic/rooms/{roomId}/members로 방송되는 방장 위임 알림(S15P11A706-72). */
public record LiveRoomHostChangedEvent(
        String hostUserId,
        String hostDisplayName
) {
}
