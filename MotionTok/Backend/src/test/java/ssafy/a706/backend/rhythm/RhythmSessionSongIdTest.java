package ssafy.a706.backend.rhythm;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.TestPropertySource;
import ssafy.a706.backend.rhythm.model.RhythmSession;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 곡 id가 <b>실제 Redis</b>를 왕복해서 살아 돌아오는지(S15P11A706-186).
 *
 * <p>이벤트 보드는 정산 시점에 "이 판이 어느 채보였나"를 알아야 성립하는데, 그 값이 세션 해시를
 * 거쳐 온다. Redis 해시는 null을 담지 못해 <b>랜덤 채보 라운드는 필드를 아예 빼고 쓰는</b>
 * 분기를 뒀다 — 목 테스트로는 그 분기가 검증되지 않는다. 여기서 깨지면 곡 지정 라운드가 조용히
 * 랜덤 채보로 정산돼 이벤트 보드에 아무것도 안 쌓인다.</p>
 */
@SpringBootTest
@TestPropertySource(properties = "app.shop.ai-provider=GPU")
class RhythmSessionSongIdTest {

    /** 실제 방과 겹치지 않도록 높은 번호를 쓴다(PresenceRepositoryIntegrationTest와 같은 관례). */
    private static final String ROOM = "test-room-999901";

    @Autowired RhythmSessionRepository sessionRepository;
    @Autowired StringRedisTemplate redis;

    @AfterEach
    void cleanUp() {
        redis.delete("rhythm:session:" + ROOM);
        redis.delete("rhythm:session:" + ROOM + ":scores");
    }

    private RhythmSession session(String songId) {
        return new RhythmSession("S-999901", 42L, "MANUAL", "catch", songId,
                1_000L, 2_000L, RhythmSession.STATUS_PLAYING);
    }

    @Test
    void 곡_지정_라운드는_songId가_그대로_돌아온다() {
        sessionRepository.saveSession(ROOM, session("ssafy-fighting-manual"));

        Optional<RhythmSession> found = sessionRepository.findSession(ROOM);

        assertThat(found).isPresent();
        assertThat(found.get().songId()).isEqualTo("ssafy-fighting-manual");
        // 나머지 필드가 한 칸씩 밀리지 않았는지 — record에 필드를 끼워 넣었으므로 같이 본다
        assertThat(found.get().difficulty()).isEqualTo("MANUAL");
        assertThat(found.get().mode()).isEqualTo("catch");
        assertThat(found.get().startAt()).isEqualTo(1_000L);
        assertThat(found.get().endAt()).isEqualTo(2_000L);
    }

    /** 랜덤 채보 라운드는 null로 돌아와야 한다 — 빈 문자열이 오면 정산이 그걸 채보 id로 읽는다. */
    @Test
    void 랜덤_채보_라운드는_songId가_null이다() {
        sessionRepository.saveSession(ROOM, session(null));

        Optional<RhythmSession> found = sessionRepository.findSession(ROOM);

        assertThat(found).isPresent();
        assertThat(found.get().songId()).isNull();
    }

    /** 곡 라운드 뒤에 랜덤 라운드를 열면 이전 songId가 남아 있으면 안 된다(해시를 지우고 다시 쓴다). */
    @Test
    void 곡_라운드_다음의_랜덤_라운드에_이전_곡이_남지_않는다() {
        sessionRepository.saveSession(ROOM, session("ssafy-fighting-manual"));
        sessionRepository.saveSession(ROOM, session(null));

        assertThat(sessionRepository.findSession(ROOM)).isPresent()
                .get().extracting(RhythmSession::songId).isNull();
    }
}
