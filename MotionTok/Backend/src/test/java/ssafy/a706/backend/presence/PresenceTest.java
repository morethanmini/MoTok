package ssafy.a706.backend.presence;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import ssafy.a706.backend.conntime.service.ConnectTimeService;
import ssafy.a706.backend.presence.model.PresenceSnapshot;
import ssafy.a706.backend.presence.model.PresenceState;
import ssafy.a706.backend.presence.repository.PresenceRepository;
import ssafy.a706.backend.presence.service.PresenceService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 접속 상태 판정 규칙 (-57 온라인 표시).
 *
 * <p>여기서 지키는 것은 <b>하트비트 간격과 TTL의 관계</b>, 그리고 <b>방에서 나올 때 roomId 필드가
 * 실제로 지워지는지</b>다. 후자를 놓치면 putAll이 옛 값을 덮지 않아 친구가 영구히 IN_ROOM으로 보인다
 * (방 정보 수정 -130에서 비밀방→공개방 전환 시 password가 남던 것과 같은 함정).</p>
 */
class PresenceTest {

    @Test
    @DisplayName("roomId가 있으면 IN_ROOM, 없으면 ONLINE")
    void snapshotStateDependsOnRoomId() {
        assertThat(PresenceSnapshot.online("MP4X9K").state()).isEqualTo(PresenceState.IN_ROOM);
        assertThat(PresenceSnapshot.online("MP4X9K").roomId()).isEqualTo("MP4X9K");

        assertThat(PresenceSnapshot.online(null).state()).isEqualTo(PresenceState.ONLINE);
        assertThat(PresenceSnapshot.online(null).roomId()).isNull();
        // 빈 문자열도 "방 밖"으로 본다 — 프론트가 실수로 ''를 보내도 IN_ROOM으로 새지 않게.
        assertThat(PresenceSnapshot.online("  ").state()).isEqualTo(PresenceState.ONLINE);
    }

    @Test
    @DisplayName("하트비트 간격은 TTL보다 충분히 짧다 — 한 번 놓쳐도 오프라인으로 튀지 않아야 한다")
    void heartbeatIntervalLeavesRoomForOneMiss() {
        PresenceService service = new PresenceService(
                mock(PresenceRepository.class), mock(ConnectTimeService.class));
        long interval = service.intervalSeconds();
        long ttl = PresenceRepository.TTL.toSeconds();

        assertThat(interval).isPositive();
        // 두 번 연속 놓쳐도 TTL이 남아 있어야 한다(간격 * 2 < TTL).
        assertThat(interval * 2).isLessThan(ttl);
    }

    @Test
    @DisplayName("방 밖에서 온 하트비트는 roomId 필드를 삭제한다 — putAll만 하면 옛 방이 남는다")
    void heartbeatOutsideRoomDeletesRoomIdField() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        HashOperations<String, Object, Object> hashOps = mock(HashOperations.class);
        given_opsForHash(redis, hashOps);

        new PresenceRepository(redis).touch(7L, null, 1_000L);

        verify(hashOps).delete("presence:7", "roomId");
    }

    @Test
    @DisplayName("방 안에서 온 하트비트는 roomId를 남긴다")
    void heartbeatInRoomKeepsRoomIdField() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        HashOperations<String, Object, Object> hashOps = mock(HashOperations.class);
        given_opsForHash(redis, hashOps);

        new PresenceRepository(redis).touch(7L, "MP4X9K", 1_000L);

        verify(hashOps, never()).delete(eq("presence:7"), any());
        verify(redis).expire("presence:7", PresenceRepository.TTL);
    }

    private static void given_opsForHash(StringRedisTemplate redis,
                                        HashOperations<String, Object, Object> hashOps) {
        org.mockito.BDDMockito.given(redis.opsForHash()).willReturn(hashOps);
    }
}
