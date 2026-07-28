package ssafy.a706.backend.presence.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisOperations;
import org.springframework.data.redis.core.SessionCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Redis 키맵 ⑦ — {@code presence:{userId}:sessions} (Hash, TTL 60s). 멀티탭 세션 원장(-143).
 *
 * <p><b>왜 필요한가</b> — 프레즌스를 STOMP 연결 수명에 묶으면 "연결 하나가 끊겼다"와 "이 사람이
 * 나갔다"가 더 이상 같은 말이 아니다. 탭 두 개를 열어 둔 사용자가 하나를 닫으면 DISCONNECT는
 * 오지만 그는 여전히 접속 중이다. 세션을 모아 두고 <b>다 비었을 때만</b> 오프라인으로 내린다.</p>
 *
 * <h4>Set이 아니라 Hash인 이유 — 두 가지 사고를 같이 막는다</h4>
 * <ol>
 *   <li><b>재배포가 남기는 유령 세션.</b> 세션 목록은 인스턴스가 들고 있는 소켓의 그림자다.
 *       앱이 재기동되면 소켓도 이벤트도 사라지지만 Redis의 항목은 남는다. 살아 있는 탭이
 *       다시 붙어 TTL을 계속 갱신하면 그 유령은 <b>영원히</b> 만료되지 않고, 마지막 탭을 닫아도
 *       "세션이 하나 남아 있다"고 판정돼 오프라인 전환이 영영 일어나지 않는다.
 *       값에 마지막 갱신 시각을 적어 두고 읽을 때마다 낡은 항목을 걷어내면 스스로 아문다.</li>
 *   <li><b>멀티탭 방 정보 진동.</b> 방에 있는 탭과 로비 탭이 번갈아 비트를 치면 방 정보가
 *       {@code IN_ROOM ↔ ONLINE}으로 20초마다 뒤집힌다. 전이마다 친구 전원에게 알림이 나가는
 *       구조에서는 이게 그대로 fan-out 폭풍이 된다. 세션<b>마다</b> 방을 기록해 두고
 *       "하나라도 방에 있으면 방에 있는 것"으로 합성하면 진동 자체가 사라진다.</li>
 * </ol>
 */
@Repository
@RequiredArgsConstructor
public class PresenceSessionRepository {

    /** presence:{userId}와 같은 수명 — 하트비트가 갱신하고, 끊기면 함께 사라진다. */
    private static final long TTL_MILLIS = PresenceRepository.TTL.toMillis();

    private static final String KEY_PREFIX = "presence:";
    private static final String KEY_SUFFIX = ":sessions";
    private static final String VALUE_SEPARATOR = "|";

    /**
     * 살아 있는 세션이 없을 때만 프레즌스와 세션 원장을 함께 지운다.
     *
     * <p>유예가 끝난 리퍼가 "세션 0개"를 확인하는 것과 실제로 지우는 것 사이에 재연결이 끼면,
     * 방금 등록된 세션과 갓 쓴 프레즌스 키를 통째로 날린다. 검사와 삭제를 한 스크립트에 넣어
     * 그 틈을 없앤다(Redis는 스크립트를 원자적으로 실행한다).</p>
     */
    private static final DefaultRedisScript<Long> DELETE_IF_IDLE = new DefaultRedisScript<>("""
            if redis.call('HLEN', KEYS[2]) > 0 then return 0 end
            redis.call('DEL', KEYS[1])
            redis.call('DEL', KEYS[2])
            return 1
            """, Long.class);

    private final StringRedisTemplate redis;

    /** 세션 한 건의 현재 상태. roomId가 null이면 그 탭은 방 밖(로비 등)에 있다. */
    public record SessionView(String sessionId, long lastSeenAt, String roomId) {
    }

    /**
     * 세션을 등록·갱신하고 낡은 항목을 걷어낸다.
     *
     * @return 청소 후 살아 있는 세션 전부(방금 갱신한 것 포함)
     */
    public List<SessionView> touch(Long userId, String sessionId, String roomId, long now) {
        String key = key(userId);
        Map<Object, Object> raw = redis.opsForHash().entries(key);

        List<SessionView> live = new ArrayList<>();
        List<Object> stale = new ArrayList<>();
        collect(raw, now, sessionId, live, stale);
        live.add(new SessionView(sessionId, now, blankToNull(roomId)));

        List<Object> expired = stale;
        redis.executePipelined(new SessionCallback<Object>() {
            @Override
            public Object execute(RedisOperations operations) {
                operations.opsForHash().put(key, sessionId, encode(now, roomId));
                if (!expired.isEmpty()) {
                    operations.opsForHash().delete(key, expired.toArray());
                }
                operations.expire(key, PresenceRepository.TTL);
                return null;
            }
        });
        return live;
    }

    /** @return 이 세션을 뺀 뒤 살아 있는 세션들. 비어 있으면 마지막 연결이었다는 뜻 */
    public List<SessionView> remove(Long userId, String sessionId, long now) {
        String key = key(userId);
        Map<Object, Object> raw = redis.opsForHash().entries(key);

        List<SessionView> live = new ArrayList<>();
        List<Object> stale = new ArrayList<>();
        collect(raw, now, sessionId, live, stale);

        stale.add(sessionId);
        redis.opsForHash().delete(key, stale.toArray());
        return live;
    }

    /** 유예가 끝난 뒤의 최종 확인용. 낡은 항목을 걷어낸 결과를 돌려준다. */
    public List<SessionView> liveSessions(Long userId, long now) {
        List<SessionView> live = new ArrayList<>();
        collect(redis.opsForHash().entries(key(userId)), now, null, live, new ArrayList<>());
        return live;
    }

    /** @return 실제로 지웠으면 true. 그 사이 새 세션이 붙었으면 false */
    public boolean deletePresenceIfIdle(Long userId) {
        Long deleted = redis.execute(DELETE_IF_IDLE,
                List.of(PresenceRepository.keyOf(userId), key(userId)));
        return deleted != null && deleted == 1L;
    }

    public void delete(Long userId) {
        redis.delete(key(userId));
    }

    /** 살아있는 세션 중 하나라도 방에 있으면 그 방이 이 사람의 위치다. */
    public static String composeRoomId(List<SessionView> sessions) {
        return sessions.stream()
                .map(SessionView::roomId)
                .filter(java.util.Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    /** 원장을 훑어 살아있는 세션과 만료된 세션으로 가른다. {@code exclude}는 호출부가 따로 다룬다. */
    private void collect(Map<Object, Object> raw, long now, String exclude,
                         List<SessionView> live, List<Object> stale) {
        long staleBefore = now - TTL_MILLIS;
        raw.forEach((field, value) -> {
            String sessionId = field.toString();
            if (sessionId.equals(exclude)) {
                return;
            }
            SessionView view = decode(sessionId, value.toString());
            if (view == null || view.lastSeenAt() < staleBefore) {
                stale.add(sessionId);
                return;
            }
            live.add(view);
        });
    }

    private String encode(long now, String roomId) {
        return now + VALUE_SEPARATOR + (blankToNull(roomId) == null ? "" : roomId);
    }

    private SessionView decode(String sessionId, String value) {
        int separator = value.indexOf(VALUE_SEPARATOR);
        if (separator < 0) {
            return null; // 예전 형식이거나 깨진 값 — 낡은 것으로 보고 걷어낸다
        }
        try {
            long lastSeenAt = Long.parseLong(value.substring(0, separator));
            return new SessionView(sessionId, lastSeenAt, blankToNull(value.substring(separator + 1)));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private String key(Long userId) {
        return KEY_PREFIX + userId + KEY_SUFFIX;
    }
}
