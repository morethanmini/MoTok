package ssafy.a706.backend.room.model;

import lombok.Getter;
import lombok.Setter;

@Getter
public class RoomParticipant {

    private final String participantId; // = JWT subject (member: userId, guest: guest-xxxx)
    private final String displayName;
    private final boolean guest;
    private final long joinedAt;

    /** STOMP 연결 시 바인딩. 연결 종료(disconnect) 처리에 사용. */
    @Setter
    private volatile String simpSessionId;

    public RoomParticipant(String participantId, String displayName, boolean guest, long joinedAt) {
        this.participantId = participantId;
        this.displayName = displayName;
        this.guest = guest;
        this.joinedAt = joinedAt;
    }
}
