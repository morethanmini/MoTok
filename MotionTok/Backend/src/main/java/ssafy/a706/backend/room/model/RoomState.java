package ssafy.a706.backend.room.model;

import lombok.Getter;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 인메모리 방 상태(엔티티 아님). 라이브 상태는 여기서만 관리하고, 확정된 결과만 DB에 저장한다.
 */
@Getter
public class RoomState {

    public enum Status { WAITING, IN_GAME }

    private final String roomId;
    private volatile String title;
    private volatile int maxPlayers;
    private volatile String selectedGameCode;
    private volatile Status status = Status.WAITING;
    private volatile String hostParticipantId;
    private volatile String activeSessionId;
    private final long createdAt;
    private final Map<String, RoomParticipant> participants = new ConcurrentHashMap<>();

    public RoomState(String roomId, String title, int maxPlayers, String selectedGameCode, RoomParticipant host) {
        this.roomId = roomId;
        this.title = title;
        this.maxPlayers = maxPlayers;
        this.selectedGameCode = selectedGameCode;
        this.createdAt = System.currentTimeMillis();
        addParticipant(host);
    }

    public synchronized void addParticipant(RoomParticipant p) {
        participants.put(p.getParticipantId(), p);
        if (hostParticipantId == null) {
            hostParticipantId = p.getParticipantId();
        }
    }

    /** @return 제거 후 방이 비었으면 true */
    public synchronized boolean removeParticipant(String participantId) {
        participants.remove(participantId);
        if (participantId.equals(hostParticipantId)) {
            reassignHost();
        }
        return participants.isEmpty();
    }

    private void reassignHost() {
        hostParticipantId = participants.values().stream()
                .min(Comparator.comparingLong(RoomParticipant::getJoinedAt))
                .map(RoomParticipant::getParticipantId)
                .orElse(null);
    }

    public boolean hasParticipant(String participantId) {
        return participants.containsKey(participantId);
    }

    public boolean isFull() {
        return participants.size() >= maxPlayers;
    }

    public boolean isHost(String participantId) {
        return participantId != null && participantId.equals(hostParticipantId);
    }

    public int participantCount() {
        return participants.size();
    }

    public List<RoomParticipant> participantList() {
        return participants.values().stream()
                .sorted(Comparator.comparingLong(RoomParticipant::getJoinedAt))
                .toList();
    }

    public Optional<RoomParticipant> findBySimpSession(String simpSessionId) {
        return participants.values().stream()
                .filter(p -> simpSessionId.equals(p.getSimpSessionId()))
                .findFirst();
    }

    public void selectGame(String gameCode) {
        this.selectedGameCode = gameCode;
    }

    public void startGame(String sessionId) {
        this.status = Status.IN_GAME;
        this.activeSessionId = sessionId;
    }

    public void backToWaiting() {
        this.status = Status.WAITING;
        this.activeSessionId = null;
    }
}
