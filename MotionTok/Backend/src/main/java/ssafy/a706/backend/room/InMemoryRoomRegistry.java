package ssafy.a706.backend.room;

import org.springframework.stereotype.Component;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.room.model.RoomParticipant;
import ssafy.a706.backend.room.model.RoomState;

import java.security.SecureRandom;
import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class InMemoryRoomRegistry implements RoomRegistry {

    private static final String CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final int CODE_LENGTH = 6;

    private final Map<String, RoomState> rooms = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    @Override
    public RoomState create(String title, int maxPlayers, String gameCode, RoomParticipant host) {
        String roomId = generateUniqueId();
        RoomState room = new RoomState(roomId, title, maxPlayers, gameCode, host);
        rooms.put(roomId, room);
        return room;
    }

    @Override
    public Optional<RoomState> find(String roomId) {
        return Optional.ofNullable(rooms.get(roomId));
    }

    @Override
    public Collection<RoomState> listWaiting() {
        return rooms.values().stream()
                .filter(r -> r.getStatus() == RoomState.Status.WAITING)
                .sorted((a, b) -> Long.compare(b.getCreatedAt(), a.getCreatedAt()))
                .toList();
    }

    @Override
    public RoomState join(String roomId, RoomParticipant participant) {
        RoomState room = rooms.get(roomId);
        if (room == null) {
            throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
        }
        if (!room.hasParticipant(participant.getParticipantId()) && room.isFull()) {
            throw new BusinessException(ErrorCode.ROOM_FULL);
        }
        room.addParticipant(participant);
        return room;
    }

    @Override
    public void remove(String roomId) {
        rooms.remove(roomId);
    }

    private String generateUniqueId() {
        String code;
        do {
            StringBuilder sb = new StringBuilder(CODE_LENGTH);
            for (int i = 0; i < CODE_LENGTH; i++) {
                sb.append(CODE_CHARS.charAt(random.nextInt(CODE_CHARS.length())));
            }
            code = sb.toString();
        } while (rooms.containsKey(code));
        return code;
    }
}
