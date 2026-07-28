package ssafy.a706.backend.presence.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisOperations;
import org.springframework.data.redis.core.SessionCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;
import ssafy.a706.backend.presence.model.PresenceSnapshot;
import ssafy.a706.backend.presence.model.PresenceState;

import java.time.Duration;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Redis 키맵 ⑥ — presence:{userId} (Hash, TTL 60s).
 *
 * <p><b>오프라인 판정은 키의 부재</b>다. 하트비트가 TTL을 갱신하지 못하면 Redis가 키를 지우므로,
 * 브라우저가 강제 종료돼도 별도 정리 없이 60초 안에 오프라인이 된다. 로그아웃처럼 의도가 분명한
 * 경우에만 즉시 DEL한다.</p>
 */
@Repository
@RequiredArgsConstructor
public class PresenceRepository {

    /** TTL — 하트비트 간격의 3배. 한두 번 놓쳐도 오프라인으로 튀지 않을 만큼의 여유. */
    public static final Duration TTL = Duration.ofSeconds(60);

    private static final String KEY_PREFIX = "presence:";
    private static final String FIELD_ROOM_ID = "roomId";
    private static final String FIELD_HEARTBEAT_AT = "heartbeatAt";

    private final StringRedisTemplate redis;

    /**
     * 하트비트 — 상태를 갱신하고 TTL을 다시 늘린다.
     *
     * <p>roomId가 없으면 필드를 <b>삭제</b>한다. putAll만 하면 방에서 나온 뒤에도 옛 roomId가 남아
     * 영구히 IN_ROOM으로 보인다(방 정보 수정 -130에서 비밀방→공개방 전환 시 password가 남던 것과 같은 함정).</p>
     */
    public void touch(Long userId, String roomId, long nowEpochMillis) {
        String key = KEY_PREFIX + userId;
        boolean inRoom = roomId != null && !roomId.isBlank();

        Map<String, String> fields = new HashMap<>();
        fields.put(FIELD_HEARTBEAT_AT, String.valueOf(nowEpochMillis));
        if (inRoom) {
            fields.put(FIELD_ROOM_ID, roomId);
        }
        redis.opsForHash().putAll(key, fields);
        if (!inRoom) {
            redis.opsForHash().delete(key, FIELD_ROOM_ID);
        }
        redis.expire(key, TTL);
    }

    /** 로그아웃처럼 즉시 오프라인으로 만들어야 하는 경우. TTL을 기다리지 않는다. */
    public void delete(Long userId) {
        redis.delete(KEY_PREFIX + userId);
    }

    /**
     * 마지막 하트비트 시각(epoch ms). 키가 없으면(오프라인·세션 첫 비트) null.
     * 접속시간(-141)이 직전 비트와의 간격(delta)을 계산하는 원천 — touch가 덮어쓰기 전에 읽어야 한다.
     */
    public Long lastHeartbeatAt(Long userId) {
        Object value = redis.opsForHash().get(KEY_PREFIX + userId, FIELD_HEARTBEAT_AT);
        return value == null ? null : Long.parseLong(value.toString());
    }

    public PresenceSnapshot find(Long userId) {
        return findAll(List.of(userId)).getOrDefault(userId, PresenceSnapshot.OFFLINE);
    }

    /**
     * 여러 사용자를 <b>한 번의 왕복</b>으로 조회한다. 친구를 한 명씩 조회하면 목록 크기만큼
     * 라운드트립이 늘어난다(N+1). 오프라인인 사용자는 결과에 넣지 않으므로,
     * 호출부는 없는 키를 OFFLINE으로 취급하면 된다.
     */
    public Map<Long, PresenceSnapshot> findAll(Collection<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        List<Long> ids = userIds.stream().distinct().toList();

        List<Object> results = redis.executePipelined(new SessionCallback<Object>() {
            @Override
            public Object execute(RedisOperations operations) {
                for (Long id : ids) {
                    operations.opsForHash().entries(KEY_PREFIX + id);
                }
                return null; // 파이프라인에서는 개별 반환값을 쓰지 않는다
            }
        });

        Map<Long, PresenceSnapshot> presences = new HashMap<>();
        for (int i = 0; i < ids.size(); i++) {
            PresenceSnapshot snapshot = toSnapshot(i < results.size() ? results.get(i) : null);
            if (snapshot.state() != PresenceState.OFFLINE) {
                presences.put(ids.get(i), snapshot);
            }
        }
        return presences;
    }

    /** 파이프라인 결과 한 칸(Hash entries) → 스냅샷. 빈 Hash는 키가 없다는 뜻이라 OFFLINE. */
    private PresenceSnapshot toSnapshot(Object raw) {
        if (!(raw instanceof Map<?, ?> hash) || hash.isEmpty()) {
            return PresenceSnapshot.OFFLINE;
        }
        Object roomId = hash.get(FIELD_ROOM_ID);
        return PresenceSnapshot.online(roomId == null ? null : roomId.toString());
    }
}
