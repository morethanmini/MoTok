package ssafy.a706.backend.game.repository;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ssafy.a706.backend.game.dto.LeaderboardRow;
import ssafy.a706.backend.game.entity.LeaderboardWeekly;
import ssafy.a706.backend.game.model.LeaderboardMode;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 주간 누적 랭킹 조회·upsert. 쿼리 모양은 {@link LeaderboardRepository}와 일부러 같다 —
 * 두 랭킹이 같은 정렬 규칙·같은 응답 모양을 쓰므로 화면이 하나의 코드로 둘 다 그린다.
 *
 * <p>정렬은 {@code score_sum DESC, updated_at ASC, user_id ASC}. 최고점 쪽의
 * best_achieved_at 자리에 updated_at이 들어갈 뿐 규칙은 동일하다.</p>
 */
public interface LeaderboardWeeklyRepository extends JpaRepository<LeaderboardWeekly, Long> {

    Optional<LeaderboardWeekly> findByGameIdAndUserIdAndModeAndWeekStart(
            Long gameId, Long userId, LeaderboardMode mode, LocalDate weekStart);

    /** 그 주 상위 N — 반환 순서가 곧 순위(1위부터)다. */
    @Query("""
            select new ssafy.a706.backend.game.dto.LeaderboardRow(
                w.userId, u.nickname, u.avatarUrl, w.scoreSum, w.playCount, w.updatedAt)
            from LeaderboardWeekly w
              join User u on u.id = w.userId
            where w.gameId = :gameId
              and w.mode = :mode
              and w.weekStart = :weekStart
              and u.status = ssafy.a706.backend.user.enums.UserStatus.ACTIVE
            order by w.scoreSum desc, w.updatedAt asc, w.userId asc
            """)
    List<LeaderboardRow> findTopRows(@Param("gameId") long gameId,
                                     @Param("mode") LeaderboardMode mode,
                                     @Param("weekStart") LocalDate weekStart,
                                     Pageable pageable);

    /** 그 주 내 기록 한 줄. 이번 주에 한 판도 안 했거나 탈퇴·정지면 empty. */
    @Query("""
            select new ssafy.a706.backend.game.dto.LeaderboardRow(
                w.userId, u.nickname, u.avatarUrl, w.scoreSum, w.playCount, w.updatedAt)
            from LeaderboardWeekly w
              join User u on u.id = w.userId
            where w.gameId = :gameId
              and w.mode = :mode
              and w.weekStart = :weekStart
              and w.userId = :userId
              and u.status = ssafy.a706.backend.user.enums.UserStatus.ACTIVE
            """)
    Optional<LeaderboardRow> findRow(@Param("gameId") long gameId,
                                     @Param("mode") LeaderboardMode mode,
                                     @Param("weekStart") LocalDate weekStart,
                                     @Param("userId") long userId);

    /** 그 주에 나보다 앞선 사람 수 — 내 순위는 이 값 + 1이다. */
    @Query("""
            select count(w)
            from LeaderboardWeekly w
              join User u on u.id = w.userId
            where w.gameId = :gameId
              and w.mode = :mode
              and w.weekStart = :weekStart
              and u.status = ssafy.a706.backend.user.enums.UserStatus.ACTIVE
              and (w.scoreSum > :score
                or (w.scoreSum = :score and w.updatedAt < :achievedAt)
                or (w.scoreSum = :score and w.updatedAt = :achievedAt and w.userId < :userId))
            """)
    long countAhead(@Param("gameId") long gameId,
                    @Param("mode") LeaderboardMode mode,
                    @Param("weekStart") LocalDate weekStart,
                    @Param("score") long score,
                    @Param("achievedAt") LocalDateTime achievedAt,
                    @Param("userId") long userId);
}
