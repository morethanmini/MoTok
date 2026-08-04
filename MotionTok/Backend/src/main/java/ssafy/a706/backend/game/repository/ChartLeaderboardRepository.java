package ssafy.a706.backend.game.repository;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ssafy.a706.backend.game.dto.LeaderboardRow;
import ssafy.a706.backend.game.entity.ChartLeaderboard;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 채보(곡)별 랭킹 조회·upsert — 이벤트 보드(S15P11A706-186).
 *
 * <p>쿼리 모양을 {@link LeaderboardRepository}와 일부러 같게 뒀다. 같은 {@link LeaderboardRow}를
 * 돌려주므로 화면·응답 조립 코드를 그대로 재사용하고, 이벤트를 접을 때는 이 파일만 지우면 된다.</p>
 */
public interface ChartLeaderboardRepository extends JpaRepository<ChartLeaderboard, Long> {

    Optional<ChartLeaderboard> findByGameIdAndChartIdAndUserId(Long gameId, String chartId, Long userId);

    /** 그 채보 상위 N — 반환 순서가 곧 순위(1위부터)다. */
    @Query("""
            select new ssafy.a706.backend.game.dto.LeaderboardRow(
                c.userId, u.nickname, u.avatarUrl, c.bestScore, c.playCount, c.bestAchievedAt)
            from ChartLeaderboard c
              join User u on u.id = c.userId
            where c.gameId = :gameId
              and c.chartId = :chartId
              and u.status = ssafy.a706.backend.user.enums.UserStatus.ACTIVE
            order by c.bestScore desc, c.bestAchievedAt asc, c.userId asc
            """)
    List<LeaderboardRow> findTopRows(@Param("gameId") long gameId,
                                     @Param("chartId") String chartId,
                                     Pageable pageable);

    /** 그 채보의 내 기록 한 줄. 아직 안 쳤거나 탈퇴·정지면 empty. */
    @Query("""
            select new ssafy.a706.backend.game.dto.LeaderboardRow(
                c.userId, u.nickname, u.avatarUrl, c.bestScore, c.playCount, c.bestAchievedAt)
            from ChartLeaderboard c
              join User u on u.id = c.userId
            where c.gameId = :gameId
              and c.chartId = :chartId
              and c.userId = :userId
              and u.status = ssafy.a706.backend.user.enums.UserStatus.ACTIVE
            """)
    Optional<LeaderboardRow> findRow(@Param("gameId") long gameId,
                                     @Param("chartId") String chartId,
                                     @Param("userId") long userId);

    /** 나보다 앞선 사람 수 — 내 순위는 이 값 + 1이다. */
    @Query("""
            select count(c)
            from ChartLeaderboard c
              join User u on u.id = c.userId
            where c.gameId = :gameId
              and c.chartId = :chartId
              and u.status = ssafy.a706.backend.user.enums.UserStatus.ACTIVE
              and (c.bestScore > :score
                or (c.bestScore = :score and c.bestAchievedAt < :achievedAt)
                or (c.bestScore = :score and c.bestAchievedAt = :achievedAt and c.userId < :userId))
            """)
    long countAhead(@Param("gameId") long gameId,
                    @Param("chartId") String chartId,
                    @Param("score") long score,
                    @Param("achievedAt") LocalDateTime achievedAt,
                    @Param("userId") long userId);
}
