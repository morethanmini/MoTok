package ssafy.a706.backend.liveroom.controller.dto;

/**
 * /topic/rooms/{roomId}/members로 방송되는 방 정보 수정 알림(S15P11A706-130).
 * 방 전원에게 쏘는 채널이라 password는 절대 포함하지 않는다.
 */
public record LiveRoomUpdatedEvent(
        String title,
        String visibility,
        int maxPlayers
) {
}
