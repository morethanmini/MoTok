package ssafy.a706.backend.liveroom.controller.dto;

import ssafy.a706.backend.liveroom.model.LiveRoom;

public record LiveRoomSummaryResponse(
        String roomId,
        String title,
        int maxPlayers,
        int participantCount,
        String status
) {
    public static LiveRoomSummaryResponse from(LiveRoom room) {
        return new LiveRoomSummaryResponse(
                room.roomId(),
                room.title(),
                room.maxPlayers(),
                room.participantCount(),
                room.status()
        );
    }
}
