package ssafy.a706.backend.game.repository;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ssafy.a706.backend.game.dto.LeaderboardRow;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.model.LeaderboardMode;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 리더보드 upsert·조회. (game_id, user_id, mode) 유니크라 이 조합으로 기존 기록을 찾아 갱신한다.
 *
 * <p><b>순위의 권위는 이 쿼리들이다.</b> 정렬은 {@code best_score DESC, best_achieved_at ASC,
 * user_id ASC} — 동점을 남기지 않는 전순서다. 마지막 user_id는 장식이 아니다: 같은 판에서 동점으로
 * 끝난 두 명은 한 트랜잭션에서 저장돼 시각이 거의 같으므로, 최종 결정자가 없으면 조회할 때마다
 * 순서가 뒤집힌다.</p>
 *
 * <p>탈퇴·정지 회원(-111)은 users 조인에서 걸러낸다. 조회 뒤 Java에서 거르던 예전 방식과 달리
 * 상위 N이 정확히 N개로 오고, 순위 count와 목록 순번이 같은 모수를 본다.</p>
 */
public interface LeaderboardRepository extends JpaRepository<Leaderboard, Long> {

    Optional<Leaderboard> findByGameIdAndUserIdAndMode(Long gameId, Long userId, LeaderboardMode mode);

    /** 한 회원의 전 게임·모드 기록 — 전적 조회(-97 내 전적, -141 친구 상세)용 역방향 조회. */
    List<Leaderboard> findAllByUserId(Long userId);

    /** 상위 N — 회원 정보까지 한 번에 읽는다. 반환 순서가 곧 순위(1위부터)다. */
    @Query("""
            select new ssafy.a706.backend.game.dto.LeaderboardRow(
                l.userId, u.nickname, u.avatarUrl, l.bestScore, l.playCount, l.bestAchievedAt)
            from Leaderboard l
              join User u on u.id = l.userId
            where l.gameId = :gameId
              and l.mode = :mode
              and u.status = ssafy.a706.backend.user.enums.UserStatus.ACTIVE
            order by l.bestScore desc, l.bestAchievedAt asc, l.userId asc
            """)
    List<LeaderboardRow> findTopRows(@Param("gameId") long gameId,
                                     @Param("mode") LeaderboardMode mode,
                                     Pageable pageable);

    /** 노출 대상 한 명의 순위표 한 줄. 기록이 없거나 탈퇴·정지면 empty. */
    @Query("""
            select new ssafy.a706.backend.game.dto.LeaderboardRow(
                l.userId, u.nickname, u.avatarUrl, l.bestScore, l.playCount, l.bestAchievedAt)
            from Leaderboard l
              join User u on u.id = l.userId
            where l.gameId = :gameId
              and l.mode = :mode
              and l.userId = :userId
              and u.status = ssafy.a706.backend.user.enums.UserStatus.ACTIVE
            """)
    Optional<LeaderboardRow> findRow(@Param("gameId") long gameId,
                                     @Param("mode") LeaderboardMode mode,
                                     @Param("userId") long userId);

    /**
     * 나보다 앞선 사람 수 — 내 순위는 이 값 + 1이다.
     * 목록의 순번과 같은 정렬 규칙으로 세므로 상위권 안이든 밖이든 순위 정의가 하나다.
     */
    @Query("""
            select count(l)
            from Leaderboard l
              join User u on u.id = l.userId
            where l.gameId = :gameId
              and l.mode = :mode
              and u.status = ssafy.a706.backend.user.enums.UserStatus.ACTIVE
              and (l.bestScore > :score
                or (l.bestScore = :score and l.bestAchievedAt < :achievedAt)
                or (l.bestScore = :score and l.bestAchievedAt = :achievedAt and l.userId < :userId))
            """)
    long countAhead(@Param("gameId") long gameId,
                    @Param("mode") LeaderboardMode mode,
                    @Param("score") long score,
                    @Param("achievedAt") LocalDateTime achievedAt,
                    @Param("userId") long userId);
}
