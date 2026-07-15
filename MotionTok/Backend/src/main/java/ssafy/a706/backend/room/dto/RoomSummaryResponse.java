package ssafy.a706.backend.room.dto;

import ssafy.a706.backend.room.model.RoomState;

public record RoomSummaryResponse(
        String roomId,
        String title,
        String status,
        String selectedGameCode,
        int maxPlayers,
        int participantCount
) {
    public static RoomSummaryResponse from(RoomState room) {
        return new RoomSummaryResponse(
                room.getRoomId(),
                room.getTitle(),
                room.getStatus().name(),
                room.getSelectedGameCode(),
                room.getMaxPlayers(),
                room.participantCount()
        );
    }
}
