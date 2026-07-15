package ssafy.a706.backend.room.dto;

import ssafy.a706.backend.room.model.RoomParticipant;

public record ParticipantResponse(String participantId, String displayName, boolean guest) {

    public static ParticipantResponse from(RoomParticipant p) {
        return new ParticipantResponse(p.getParticipantId(), p.getDisplayName(), p.isGuest());
    }
}
