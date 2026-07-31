package ssafy.a706.backend.presence;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import ssafy.a706.backend.presence.model.PresenceSnapshot;
import ssafy.a706.backend.presence.model.PresenceState;
import ssafy.a706.backend.presence.repository.PresenceRepository;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * presence:{userId}를 <b>실제 Redis</b>에 대고 확인한다.
 *
 * <p>목으로는 잡히지 않는 두 가지 때문에 통합 테스트가 필요하다:</p>
 * <ol>
 *   <li><b>executePipelined의 역직렬화</b> — 결과가 기대한 Map 형태로 오지 않으면 toSnapshot이
 *       조용히 전원 OFFLINE을 돌려준다. 목 테스트는 이걸 통과시킨다.</li>
 *   <li><b>Hash 필드 삭제</b> — 방에서 나올 때 roomId가 정말 사라지는지. putAll은 필드를 못 지운다.</li>
 * </ol>
 */
@SpringBootTest
class PresenceRepositoryIntegrationTest {

    /** 실제 사용자와 겹치지 않도록 높은 번호를 쓴다. */
    private static final Long USER_A = 999_001L;
    private static final Long USER_B = 999_002L;
    private static final Long USER_OFFLINE = 999_003L;

    @Autowired
    private PresenceRepository presenceRepository;

    @Autowired
    private StringRedisTemplate redis;

    @AfterEach
    void cleanUp() {
        List.of(USER_A, USER_B, USER_OFFLINE).forEach(presenceRepository::delete);
    }

    @Test
    @DisplayName("방 안 하트비트 → IN_ROOM + roomId 를 파이프라인 조회로 되읽는다")
    void readsBackInRoomPresence() {
        presenceRepository.touch(USER_A, "MP4X9K", System.currentTimeMillis());

        PresenceSnapshot snapshot = presenceRepository.find(USER_A);

        assertThat(snapshot.state()).isEqualTo(PresenceState.IN_ROOM);
        assertThat(snapshot.roomId()).isEqualTo("MP4X9K");
    }

    @Test
    @DisplayName("방에서 나오면 roomId 필드가 실제로 사라져 ONLINE이 된다")
    void leavingRoomClearsRoomIdInRedis() {
        presenceRepository.touch(USER_A, "MP4X9K", System.currentTimeMillis());
        presenceRepository.touch(USER_A, null, System.currentTimeMillis());

        PresenceSnapshot snapshot = presenceRepository.find(USER_A);

        assertThat(snapshot.state()).isEqualTo(PresenceState.ONLINE);
        assertThat(snapshot.roomId()).isNull();
        // Redis 쪽에서도 필드 자체가 없어야 한다(값만 비운 게 아니라).
        assertThat(redis.opsForHash().hasKey("presence:" + USER_A, "roomId")).isFalse();
    }

    @Test
    @DisplayName("여러 명을 한 번에 조회하고, 접속 안 한 사람은 결과에 없다")
    void bulkLookupSkipsOfflineUsers() {
        presenceRepository.touch(USER_A, "ROOM-A", System.currentTimeMillis());
        presenceRepository.touch(USER_B, null, System.currentTimeMillis());

        Map<Long, PresenceSnapshot> presences =
                presenceRepository.findAll(List.of(USER_A, USER_B, USER_OFFLINE));

        assertThat(presences).containsOnlyKeys(USER_A, USER_B);
        assertThat(presences.get(USER_A).state()).isEqualTo(PresenceState.IN_ROOM);
        assertThat(presences.get(USER_A).roomId()).isEqualTo("ROOM-A");
        assertThat(presences.get(USER_B).state()).isEqualTo(PresenceState.ONLINE);
        assertThat(presences).doesNotContainKey(USER_OFFLINE);
    }

    @Test
    @DisplayName("delete는 즉시 오프라인으로 만든다 — 로그아웃이 TTL을 기다리지 않는 근거")
    void deleteMakesOfflineImmediately() {
        presenceRepository.touch(USER_A, null, System.currentTimeMillis());
        presenceRepository.delete(USER_A);

        assertThat(presenceRepository.find(USER_A).state()).isEqualTo(PresenceState.OFFLINE);
    }

    @Test
    @DisplayName("스캔이 접속자를 훑되 세션 원장 키(presence:{id}:sessions)는 걸러 낸다")
    void scanOnlineSkipsSessionLedgerKeys() {
        long now = System.currentTimeMillis();
        presenceRepository.touch(USER_A, "ROOM-A", now);
        presenceRepository.touch(USER_B, null, now);
        // 세션 원장은 같은 접두사를 쓴다 — 함께 걸리면 userId 파싱이 깨지거나 유령 접속자가 생긴다.
        redis.opsForHash().put("presence:" + USER_B + ":sessions", "sess-1", now + "|");

        List<PresenceRepository.OnlinePresence> online = presenceRepository.scanOnline(500);

        assertThat(online).extracting(PresenceRepository.OnlinePresence::userId)
                .contains(USER_A, USER_B)
                .doesNotContainNull();
        PresenceRepository.OnlinePresence a = online.stream()
                .filter(p -> p.userId().equals(USER_A)).findFirst().orElseThrow();
        assertThat(a.roomId()).isEqualTo("ROOM-A");
        assertThat(a.heartbeatAt()).isEqualTo(now);
        // 방 밖은 roomId가 비어 있어야 한다(화면이 '로비'로 그린다).
        assertThat(online.stream().filter(p -> p.userId().equals(USER_B)).findFirst().orElseThrow().roomId())
                .isNull();

        redis.delete("presence:" + USER_B + ":sessions");
    }

    @Test
    @DisplayName("상한을 넘겨 훑지 않는다 — 응답 크기가 접속자 수에 끌려가지 않아야 한다")
    void scanOnlineRespectsLimit() {
        long now = System.currentTimeMillis();
        presenceRepository.touch(USER_A, null, now);
        presenceRepository.touch(USER_B, null, now);

        assertThat(presenceRepository.scanOnline(1)).hasSize(1);
    }

    @Test
    @DisplayName("하트비트가 TTL을 다시 늘린다 — 갱신이 안 되면 결국 사라진다")
    void heartbeatRefreshesTtl() {
        presenceRepository.touch(USER_A, null, System.currentTimeMillis());

        Long ttl = redis.getExpire("presence:" + USER_A);

        assertThat(ttl).isNotNull().isPositive();
        assertThat(ttl).isLessThanOrEqualTo(PresenceRepository.TTL.toSeconds());
    }
}
