package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 리더보드 솔로/멀티 분리(-96 확장) 스키마 정리.
 * ddl-auto:update는 mode 컬럼·새 유니크 제약은 추가해 주지만 옛 유니크 제약
 * (uk_leaderboard_game_user)은 지우지 못한다 — 남아 있으면 같은 (game, user)의
 * SOLO/MULTI 두 행 적재가 막히므로 부팅 시 있으면 지운다(없으면 무시, 멱등).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LeaderboardSchemaMigration implements ApplicationRunner {

    private final JdbcTemplate jdbcTemplate;

    @Override
    public void run(ApplicationArguments args) {
        try {
            jdbcTemplate.execute("ALTER TABLE leaderboards DROP INDEX uk_leaderboard_game_user");
            log.info("leaderboards: stale unique index uk_leaderboard_game_user dropped");
        } catch (Exception e) {
            // 이미 제거됐거나 신규 스키마 — 정상
        }
    }
}
