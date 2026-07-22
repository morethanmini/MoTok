package ssafy.a706.backend.liveroom.controller.dto;

import ssafy.a706.backend.liveroom.model.LiveRoom;

public record CreateLiveRoomResponse(
        String roomId,
        String title,
        String visibility,
        int maxPlayers,
        String status,
        String hostUserId,
        long createdAt,
        String inviteCode,
        String inviteLink
) {
    public static CreateLiveRoomResponse from(LiveRoom room, String inviteLinkBaseUrl) {
        return new CreateLiveRoomResponse(
                room.roomId(),
                room.title(),
                room.visibility().name(),
                room.maxPlayers(),
                room.status(),
                room.hostUserId(),
                room.createdAt(),
                room.inviteCode(),
                room.inviteCode() == null ? null : inviteLinkBaseUrl + "?code=" + room.inviteCode()
        );
    }
}
