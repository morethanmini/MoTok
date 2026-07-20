package ssafy.a706.backend.room.dto;

import ssafy.a706.backend.room.model.RoomState;

import java.util.List;

public record RoomResponse(
        String roomId,
        String title,
        String hostParticipantId,
        String status,
        String selectedGameCode,
        int maxPlayers,
        int participantCount,
        String activeSessionId,
        List<ParticipantResponse> participants
) {
    public static RoomResponse from(RoomState room) {
        return new RoomResponse(
                room.getRoomId(),
                room.getTitle(),
                room.getHostParticipantId(),
                room.getStatus().name(),
                room.getSelectedGameCode(),
                room.getMaxPlayers(),
                room.participantCount(),
                room.getActiveSessionId(),
                room.participantList().stream().map(ParticipantResponse::from).toList()
        );
    }
}
