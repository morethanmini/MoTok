package ssafy.a706.backend.liveroom.controller.dto;

import ssafy.a706.backend.liveroom.model.LiveRoom;

public record LiveRoomSummaryResponse(
        String roomId,
        String title,
        String visibility,
        int maxPlayers,
        int participantCount,
        String status,
        boolean hasPassword
) {
    public static LiveRoomSummaryResponse from(LiveRoom room) {
        return new LiveRoomSummaryResponse(
                room.roomId(),
                room.title(),
                room.visibility().name(),
                room.maxPlayers(),
                room.participantCount(),
                room.status(),
                room.hasPassword()
        );
    }
}
