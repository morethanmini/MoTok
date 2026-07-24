package ssafy.a706.backend.game.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;

import java.util.Map;

/**
 * 게임별 라이브 랭킹 Redis 접근(S15P11A706-117 · 키맵 ③).
 * {@code rank:{gameId}}(ZSET, TTL 없음, member=userId, score=best_score) — 게임별 세계순위.
 *
 * <p>정산 트랜잭션이 확정한 best_score(권위값)를 그대로 ZADD한다. best_score는 이미 GREATEST가
 * 적용된 최댓값이라 조건부(GT) 없이 덮어써도 항상 참값이다. 조회(-96)·유실 시 warm-up은 별개.</p>
 */
@Repository
@RequiredArgsConstructor
public class GameRankRedisRepository {

    private final StringRedisTemplate redisTemplate;

    /** (userId → best_score) 맵을 rank:{gameId} ZSET에 반영한다. */
    public void updateRanks(long gameId, Map<Long, Integer> bestScores) {
        if (bestScores.isEmpty()) {
            return;
        }
        String key = rankKey(gameId);
        bestScores.forEach((userId, best) ->
                redisTemplate.opsForZSet().add(key, String.valueOf(userId), best));
    }

    private String rankKey(long gameId) {
        return "rank:" + gameId;
    }
}
