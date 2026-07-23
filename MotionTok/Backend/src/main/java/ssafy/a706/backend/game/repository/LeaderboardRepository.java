package ssafy.a706.backend.game.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.game.entity.Leaderboard;

import java.util.Optional;

/** 리더보드 upsert·조회. (game_id, user_id) 유니크라 이 조합으로 기존 기록을 찾아 갱신한다. */
public interface LeaderboardRepository extends JpaRepository<Leaderboard, Long> {

    Optional<Leaderboard> findByGameIdAndUserId(Long gameId, Long userId);
}
