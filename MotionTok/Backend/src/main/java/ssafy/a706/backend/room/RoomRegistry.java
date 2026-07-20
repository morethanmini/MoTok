package ssafy.a706.backend.room;

import ssafy.a706.backend.room.model.RoomParticipant;
import ssafy.a706.backend.room.model.RoomState;

import java.util.Collection;
import java.util.Optional;

/**
 * 방 라이브 상태 저장소. 인메모리 구현(InMemoryRoomRegistry)을 기본으로 하되,
 * 추후 Redis 구현으로 교체 가능하도록 인터페이스로 둔다.
 */
public interface RoomRegistry {

    RoomState create(String title, int maxPlayers, String gameCode, RoomParticipant host);

    Optional<RoomState> find(String roomId);

    Collection<RoomState> listWaiting();

    RoomState join(String roomId, RoomParticipant participant);

    void remove(String roomId);
}
