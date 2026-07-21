package ssafy.a706.backend.signal;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;

/**
 * liveroom(Redis) 기반 구현. 키를 직접 읽지 않고 LiveRoomRepository에 위임해
 * 키 스키마·직렬화 포맷 변경(-24 후속)에 시그널링이 영향받지 않게 한다.
 * 읽기 검증뿐이라 원자성(Lua 등)은 필요 없다 — 검증 직후 퇴장하는 경합은
 * 수신자 부재 시 브로커가 조용히 버리는 기존 동작과 동일하게 무해하다.
 */
@Component
@RequiredArgsConstructor
public class LiveRoomMembershipReader implements RoomMembershipReader {

    private final LiveRoomRepository liveRoomRepository;

    @Override
    public boolean existsRoom(String roomId) {
        return liveRoomRepository.findRoomFields(roomId).isPresent();
    }

    @Override
    public boolean isMember(String roomId, String participantId) {
        return liveRoomRepository.findMembers(roomId).stream()
                .anyMatch(m -> m.userId().equals(participantId));
    }
}
