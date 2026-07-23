package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;
import ssafy.a706.backend.game.model.GamePlayerScore;
import ssafy.a706.backend.game.model.GameSession;

import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * 게임 세션(S15P11A706-116) Redis 접근 계층.
 * game:session:{roomId}(Hash, TTL 30m) — sessionId·gameId·constellationKey·startAt·endAt·status
 * game:session:{roomId}:scores(Hash, TTL 30m) — field=참가자 userId, value=URL-encoded 점수
 * game:session:{roomId}:ended:{sessionId}(String NX, TTL 30m) — 정산 1회 실행 보장용 가드
 *
 * <p>방 하나에 동시 세션은 하나 — 키를 sessionId가 아닌 roomId로 잡아 조회를 단순화하고,
 * sessionId는 stale 세션 구분·정산 멱등 가드에 쓴다. 값 인코딩은 liveroom과 동일한
 * URL-encoded key=value(jackson-databind 미포함 사정 공유).</p>
 */
@Repository
@RequiredArgsConstructor
public class GameSessionRepository {

    private static final Duration SESSION_TTL = Duration.ofMinutes(30);

    private final StringRedisTemplate redisTemplate;

    public void saveSession(String roomId, GameSession session) {
        String key = sessionKey(roomId);
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("sessionId", session.sessionId());
        fields.put("gameId", String.valueOf(session.gameId()));
        fields.put("constellationKey", session.constellationKey());
        fields.put("startAt", String.valueOf(session.startAt()));
        fields.put("endAt", String.valueOf(session.endAt()));
        fields.put("status", session.status());
        // 이전 세션 잔재(점수 포함)를 지우고 새로 시작한다.
        redisTemplate.delete(key);
        redisTemplate.delete(scoresKey(roomId));
        redisTemplate.<String, String>opsForHash().putAll(key, fields);
        redisTemplate.expire(key, SESSION_TTL);
    }

    public Optional<GameSession> findSession(String roomId) {
        Map<Object, Object> f = redisTemplate.opsForHash().entries(sessionKey(roomId));
        if (f.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(new GameSession(
                (String) f.get("sessionId"),
                Long.parseLong((String) f.get("gameId")),
                (String) f.get("constellationKey"),
                Long.parseLong((String) f.get("startAt")),
                Long.parseLong((String) f.get("endAt")),
                (String) f.get("status")
        ));
    }

    public void markEnded(String roomId) {
        redisTemplate.<String, String>opsForHash().put(sessionKey(roomId), "status", GameSession.STATUS_ENDED);
    }

    /**
     * 정산 1회 실행 가드 — 타이머 스레드와 "전원 완주" 조기 종료가 경합해도
     * Redis SETNX로 한쪽만 true를 받는다.
     */
    public boolean tryAcquireEndGuard(String roomId, String sessionId) {
        Boolean acquired = redisTemplate.opsForValue()
                .setIfAbsent(endedKey(roomId, sessionId), "1", SESSION_TTL);
        return Boolean.TRUE.equals(acquired);
    }

    /**
     * 참가자 점수 저장 — 최초 제출만 유효(HSETNX). 중복/재제출은 무시된다.
     *
     * @return 최초 제출이면 true
     */
    public boolean saveScoreIfAbsent(String roomId, GamePlayerScore score) {
        String key = scoresKey(roomId);
        Boolean added = redisTemplate.<String, String>opsForHash()
                .putIfAbsent(key, score.userId(), encodeScore(score));
        redisTemplate.expire(key, SESSION_TTL);
        return Boolean.TRUE.equals(added);
    }

    /** 참가자 userId → 점수. 제출한 참가자만 포함된다. */
    public Map<String, GamePlayerScore> findScores(String roomId) {
        Map<String, GamePlayerScore> out = new HashMap<>();
        redisTemplate.opsForHash().entries(scoresKey(roomId))
                .forEach((k, v) -> out.put((String) k, decodeScore((String) k, (String) v)));
        return out;
    }

    public long countScores(String roomId) {
        Long size = redisTemplate.opsForHash().size(scoresKey(roomId));
        return size == null ? 0 : size;
    }

    private String encodeScore(GamePlayerScore s) {
        return "nickname=" + URLEncoder.encode(s.nickname(), StandardCharsets.UTF_8)
                + "&score=" + s.score()
                + "&starsHit=" + s.starsHit()
                + "&finishedAt=" + s.finishedAt();
    }

    private GamePlayerScore decodeScore(String userId, String encoded) {
        Map<String, String> parts = new HashMap<>();
        for (String pair : encoded.split("&")) {
            int eq = pair.indexOf('=');
            parts.put(pair.substring(0, eq), pair.substring(eq + 1));
        }
        return new GamePlayerScore(
                userId,
                URLDecoder.decode(parts.get("nickname"), StandardCharsets.UTF_8),
                Integer.parseInt(parts.get("score")),
                Integer.parseInt(parts.get("starsHit")),
                Long.parseLong(parts.get("finishedAt"))
        );
    }

    private String sessionKey(String roomId) {
        return "game:session:" + roomId;
    }

    private String scoresKey(String roomId) {
        return "game:session:" + roomId + ":scores";
    }

    private String endedKey(String roomId, String sessionId) {
        return "game:session:" + roomId + ":ended:" + sessionId;
    }
}
