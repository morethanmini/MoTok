package ssafy.a706.backend.conntime.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;

import java.util.HashSet;
import java.util.Set;

/**
 * Redis 키맵 — {@code conntime:{userId}} (String 카운터, TTL 없음, -141 접속시간).
 *
 * <p>하트비트마다 직전 구간(delta)을 INCRBY로 쌓아 두는 <b>미정산 버퍼</b>다. RDB에는 매 비트마다
 * 쓰지 않는다 — 동접이 늘면 하트비트(20s)마다의 upsert가 그대로 DB 부하가 되기 때문. 오프라인
 * 전환을 감지한 스윕(ConnectTimeFlushScheduler)·로그아웃이 GETDEL로 한 번에 걷어 RDB로 흘린다.</p>
 *
 * <p>TTL을 두지 않는 이유 — 만료는 곧 누적분 유실이다. flush가 지워야 할 시점을 안다(정산 후 삭제).
 * flush가 실패하면 값을 되돌려 두므로 키가 고아로 남아도 다음 스윕이 다시 걷는다.</p>
 */
@Repository
@RequiredArgsConstructor
public class ConnectTimeRedisRepository {

    private static final String KEY_PREFIX = "conntime:";

    private final StringRedisTemplate redis;

    /** 직전 하트비트 구간(초)을 누적한다. */
    public void increment(Long userId, long seconds) {
        redis.opsForValue().increment(KEY_PREFIX + userId, seconds);
    }

    /**
     * 미정산 누적분을 <b>원자적으로 걷어온다</b>(GETDEL, Redis 6.2+ — 배포는 7.4).
     * GET 후 DEL로 나누면 그 사이에 들어온 INCRBY가 지워져 유실된다. 없으면 null.
     */
    public Long pop(Long userId) {
        String value = redis.opsForValue().getAndDelete(KEY_PREFIX + userId);
        return value == null ? null : Long.parseLong(value);
    }

    /** 아직 걷지 않은 누적분(초) — 조회 화면에서 RDB 확정치에 얹어 실시간 값을 만든다. 없으면 0. */
    public long pendingOf(Long userId) {
        String value = redis.opsForValue().get(KEY_PREFIX + userId);
        return value == null ? 0 : Long.parseLong(value);
    }

    /** 미정산 버퍼가 있는 회원 전부 — 스윕이 오프라인 여부를 대조할 후보 목록. */
    public Set<Long> pendingUserIds() {
        Set<Long> userIds = new HashSet<>();
        ScanOptions options = ScanOptions.scanOptions().match(KEY_PREFIX + "*").count(100).build();
        try (Cursor<String> cursor = redis.scan(options)) {
            while (cursor.hasNext()) {
                String key = cursor.next();
                try {
                    userIds.add(Long.parseLong(key.substring(KEY_PREFIX.length())));
                } catch (NumberFormatException ignored) {
                    // conntime: 뒤가 숫자가 아니면 우리 키가 아니다 — 건너뛴다
                }
            }
        }
        return userIds;
    }
}
