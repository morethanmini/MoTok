package ssafy.a706.backend.game.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.game.entity.Leaderboard;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** 리더보드 upsert·조회. (game_id, user_id) 유니크라 이 조합으로 기존 기록을 찾아 갱신한다. */
public interface LeaderboardRepository extends JpaRepository<Leaderboard, Long> {

    Optional<Leaderboard> findByGameIdAndUserId(Long gameId, Long userId);

    /** Redis rank ZSET 유실 시 warm-up 재적재용 전체 로드(-96 비기능). */
    List<Leaderboard> findAllByGameId(Long gameId);

    /** 리더보드 화면 hydration(플레이 횟수)용 일괄 조회. */
    List<Leaderboard> findAllByGameIdAndUserIdIn(Long gameId, Collection<Long> userIds);
}
