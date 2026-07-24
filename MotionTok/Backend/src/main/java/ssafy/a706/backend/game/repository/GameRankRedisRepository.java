package ssafy.a706.backend.game.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Repository;
import ssafy.a706.backend.game.model.LeaderboardMode;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 게임별 라이브 랭킹 Redis 접근(S15P11A706-117 · 키맵 ③).
 * 멀티 {@code rank:{gameId}} / 솔로 {@code rank:{gameId}:solo}(-96 확장)
 * (ZSET, TTL 없음, member=userId, score=best_score) — 게임·모드별 세계순위.
 * 멀티가 기존 키를 그대로 쓰므로 배포된 ZSET 데이터는 그대로 멀티 랭킹이 된다.
 *
 * <p>정산 트랜잭션이 확정한 best_score(권위값)를 그대로 ZADD한다. best_score는 이미 GREATEST가
 * 적용된 최댓값이라 조건부(GT) 없이 덮어써도 항상 참값이다. 조회(-96)·유실 시 warm-up은 별개.</p>
 */
@Repository
@RequiredArgsConstructor
public class GameRankRedisRepository {

    private final StringRedisTemplate redisTemplate;

    /** (userId → best_score) 맵을 게임·모드별 rank ZSET에 반영한다. */
    public void updateRanks(long gameId, LeaderboardMode mode, Map<Long, Integer> bestScores) {
        if (bestScores.isEmpty()) {
            return;
        }
        String key = rankKey(gameId, mode);
        bestScores.forEach((userId, best) ->
                redisTemplate.opsForZSet().add(key, String.valueOf(userId), best));
    }

    /** 상위 N — best_score 내림차순, 삽입 순서를 보존한 (userId → best_score) 맵(-96). */
    public Map<Long, Integer> topBestScores(long gameId, LeaderboardMode mode, int limit) {
        Map<Long, Integer> out = new LinkedHashMap<>();
        Set<ZSetOperations.TypedTuple<String>> tuples = redisTemplate.opsForZSet()
                .reverseRangeWithScores(rankKey(gameId, mode), 0, limit - 1L);
        if (tuples == null) {
            return out;
        }
        for (ZSetOperations.TypedTuple<String> tuple : tuples) {
            if (tuple.getValue() == null || tuple.getScore() == null) {
                continue;
            }
            out.put(Long.parseLong(tuple.getValue()), tuple.getScore().intValue());
        }
        return out;
    }

    /** 0-기반 역순위(ZREVRANK). 랭킹에 없으면 empty. */
    public Optional<Long> reverseRankOf(long gameId, LeaderboardMode mode, long userId) {
        return Optional.ofNullable(
                redisTemplate.opsForZSet().reverseRank(rankKey(gameId, mode), String.valueOf(userId)));
    }

    /** 랭킹에 적재된 인원 수 — 0이면 유실로 보고 DB warm-up 대상. */
    public long size(long gameId, LeaderboardMode mode) {
        Long count = redisTemplate.opsForZSet().zCard(rankKey(gameId, mode));
        return count == null ? 0 : count;
    }

    private String rankKey(long gameId, LeaderboardMode mode) {
        return mode == LeaderboardMode.SOLO ? "rank:" + gameId + ":solo" : "rank:" + gameId;
    }
}
