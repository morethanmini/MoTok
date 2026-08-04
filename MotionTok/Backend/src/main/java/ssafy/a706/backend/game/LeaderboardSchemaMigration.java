package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * ddl-auto:update가 못 하는 leaderboards 스키마 정리 — 전부 멱등이라 매 부팅 돌려도 안전하다.
 *
 * <p><b>① 옛 유니크 제약 제거</b>(-96 확장). ddl-auto는 mode 컬럼·새 유니크 제약은 추가해 주지만
 * 옛 제약(uk_leaderboard_game_user)은 지우지 못한다 — 남아 있으면 같은 (game, user)의
 * SOLO/MULTI 두 행 적재가 막힌다.</p>
 *
 * <p><b>② best_achieved_at 백필</b>(동점 tie-break). ddl-auto는 <b>행이 있는 테이블에 NOT NULL
 * 컬럼을 못 넣는다</b> — MySQL이 암묵 기본값 '0000-00-00'을 쓰려다 strict 모드에서 걸려 ALTER가
 * 실패하고, ddl-auto는 그 실패를 경고만 남기고 넘어간다. 그래서 nullable로 넣고 → updated_at으로
 * 백필하고 → NOT NULL로 승격하는 3단계를 여기서 직접 한다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LeaderboardSchemaMigration implements ApplicationRunner {

    private final JdbcTemplate jdbcTemplate;

    @Override
    public void run(ApplicationArguments args) {
        dropStaleUniqueIndex();
        backfillBestAchievedAt();
    }

    private void dropStaleUniqueIndex() {
        try {
            jdbcTemplate.execute("ALTER TABLE leaderboards DROP INDEX uk_leaderboard_game_user");
            log.info("leaderboards: stale unique index uk_leaderboard_game_user dropped");
        } catch (Exception e) {
            // 이미 제거됐거나 신규 스키마 — 정상
        }
    }

    /**
     * best_achieved_at을 채우고 NOT NULL로 굳힌다.
     *
     * <p>백필 값은 updated_at이다 — 최고점을 찍은 시각이 아니라 마지막으로 플레이한 시각이라
     * 참값이 아니지만, 남아 있는 시각이 그것뿐이다. 배포 이후 갱신되는 기록부터는 정확하다.</p>
     */
    private void backfillBestAchievedAt() {
        // 1) 컬럼 확보 — ddl-auto가 NOT NULL로 넣다 실패했을 수 있으므로 nullable로 시도한다
        try {
            jdbcTemplate.execute(
                    "ALTER TABLE leaderboards ADD COLUMN best_achieved_at datetime(6) NULL");
            log.info("leaderboards: best_achieved_at column added");
        } catch (Exception e) {
            // 이미 있음(ddl-auto가 넣었거나 지난 부팅에서 넣음) — 정상
        }
        // 2) 백필 — 첫 부팅에서만 행이 잡히고 이후에는 0건
        try {
            int filled = jdbcTemplate.update(
                    "UPDATE leaderboards SET best_achieved_at = updated_at WHERE best_achieved_at IS NULL");
            if (filled > 0) {
                log.info("leaderboards: best_achieved_at backfilled from updated_at ({} rows)", filled);
            }
        } catch (Exception e) {
            // 컬럼 자체가 없으면(1이 실패했고 ddl-auto도 못 넣은 경우) 3단계도 실패한다 — 그때 드러난다
            log.warn("leaderboards: best_achieved_at backfill failed", e);
        }
        // 3) NOT NULL 승격 — 엔티티 선언(nullable=false)과 실제 스키마를 맞춘다
        try {
            jdbcTemplate.execute(
                    "ALTER TABLE leaderboards MODIFY best_achieved_at datetime(6) NOT NULL");
        } catch (Exception e) {
            log.warn("leaderboards: best_achieved_at NOT NULL promotion failed", e);
        }
    }
}
