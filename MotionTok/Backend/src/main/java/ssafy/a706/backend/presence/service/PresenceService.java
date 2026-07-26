package ssafy.a706.backend.presence.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.presence.model.PresenceSnapshot;
import ssafy.a706.backend.presence.repository.PresenceRepository;

import java.util.Collection;
import java.util.Map;

/**
 * 접속 상태 갱신·조회 (-57 온라인 표시, -98 친구방 입장의 선행).
 *
 * <p>왜 STOMP 연결 이벤트가 아니라 HTTP 하트비트인가 — 프론트의 STOMP 클라이언트는 게임룸에서만
 * 연결된다(useRoomChat). 연결 여부로 판정하면 로비에 있는 사용자가 오프라인으로 보여 ONLINE 상태
 * 자체를 표현할 수 없다. 하트비트는 그 대신 TTL이 끊김 감지를 대신 해 주므로, 세션 참조 카운팅이나
 * 유예 타이머(RoomPresenceTracker가 방 단위로 하는 일)를 다시 만들 필요가 없다.</p>
 */
@Service
@RequiredArgsConstructor
public class PresenceService {

    /** 하트비트 간격 = TTL의 1/3. 한 번 놓쳐도 아직 TTL이 남아 오프라인으로 튀지 않는다. */
    private static final int HEARTBEAT_DIVISOR = 3;

    private final PresenceRepository presenceRepository;

    /** 하트비트 1회 — 상태를 갱신하고 다음 호출까지의 간격(초)을 돌려준다. */
    public long heartbeat(Long userId, String roomId) {
        presenceRepository.touch(userId, roomId, System.currentTimeMillis());
        return intervalSeconds();
    }

    public long intervalSeconds() {
        return PresenceRepository.TTL.toSeconds() / HEARTBEAT_DIVISOR;
    }

    /** 로그아웃 — TTL을 기다리지 않고 즉시 오프라인으로 만든다. */
    public void clear(Long userId) {
        presenceRepository.delete(userId);
    }

    public PresenceSnapshot find(Long userId) {
        return presenceRepository.find(userId);
    }

    /** 친구 목록처럼 여러 명을 한꺼번에 볼 때. 결과에 없는 사용자는 오프라인이다. */
    public Map<Long, PresenceSnapshot> findAll(Collection<Long> userIds) {
        return presenceRepository.findAll(userIds);
    }
}
