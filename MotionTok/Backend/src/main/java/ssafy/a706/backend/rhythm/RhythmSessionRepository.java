package ssafy.a706.backend.rhythm;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;
import ssafy.a706.backend.rhythm.model.RhythmPlayerScore;
import ssafy.a706.backend.rhythm.model.RhythmSession;

import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * 캐치캐치리듬 세션 Redis 접근 계층 — 기존 game:session:* 과 **키가 겹치지 않는다**.
 *
 * <pre>
 * rhythm:session:{roomId}                    Hash, TTL 30m — 세션 필드
 * rhythm:session:{roomId}:scores             Hash, TTL 30m — field=userId, value=URL-encoded 점수
 * rhythm:session:{roomId}:ended:{sessionId}  String NX, TTL 30m — 정산 1회 실행 가드
 * </pre>
 *
 * <p>값 인코딩은 프로젝트 관례대로 URL-encoded key=value(jackson-databind 미포함).
 * <b>읽기는 전부 null 안전하게</b> 처리한다 — 필드가 빠진 해시를 무방비로 파싱하면
 * 배포 중 stale 세션에서 런타임 예외가 난다(기존 게임 세션에서 확인된 위험).</p>
 */
@Repository
@RequiredArgsConstructor
public class RhythmSessionRepository {

    private static final Duration SESSION_TTL = Duration.ofMinutes(30);

    private final StringRedisTemplate redisTemplate;

    public void saveSession(String roomId, RhythmSession session) {
        String key = sessionKey(roomId);
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("sessionId", session.sessionId());
        fields.put("seed", Long.toString(session.seed()));
        fields.put("difficulty", session.difficulty());
        fields.put("mode", session.mode());
        fields.put("startAt", Long.toString(session.startAt()));
        fields.put("endAt", Long.toString(session.endAt()));
        fields.put("status", session.status());
        // 이전 라운드 잔재(점수 포함)를 지우고 새로 시작한다.
        redisTemplate.delete(key);
        redisTemplate.delete(scoresKey(roomId));
        redisTemplate.<String, String>opsForHash().putAll(key, fields);
        redisTemplate.expire(key, SESSION_TTL);
    }

    public Optional<RhythmSession> findSession(String roomId) {
        Map<Object, Object> f = redisTemplate.opsForHash().entries(sessionKey(roomId));
        if (f.isEmpty()) {
            return Optional.empty();
        }
        String sessionId = str(f, "sessionId");
        if (sessionId == null) {
            return Optional.empty(); // 손상된 해시 — 없는 것으로 본다
        }
        return Optional.of(new RhythmSession(
                sessionId,
                num(f, "seed", 0L),
                str(f, "difficulty") == null ? "NORMAL" : str(f, "difficulty"),
                str(f, "mode") == null ? "catch" : str(f, "mode"),
                num(f, "startAt", 0L),
                num(f, "endAt", 0L),
                str(f, "status") == null ? RhythmSession.STATUS_ENDED : str(f, "status")));
    }

    public void markEnded(String roomId) {
        redisTemplate.<String, String>opsForHash()
                .put(sessionKey(roomId), "status", RhythmSession.STATUS_ENDED);
    }

    /** 정산 1회 실행 가드 — 타이머와 "전원 완주" 조기 종료가 경합해도 한쪽만 true를 받는다. */
    public boolean tryAcquireEndGuard(String roomId, String sessionId) {
        Boolean acquired = redisTemplate.opsForValue()
                .setIfAbsent(endedKey(roomId, sessionId), "1", SESSION_TTL);
        return Boolean.TRUE.equals(acquired);
    }

    /** 최초 제출만 유효(HSETNX). 중복·재제출은 무시된다. @return 최초 제출이면 true */
    public boolean saveScoreIfAbsent(String roomId, RhythmPlayerScore score) {
        String key = scoresKey(roomId);
        Boolean added = redisTemplate.<String, String>opsForHash()
                .putIfAbsent(key, score.userId(), encode(score));
        redisTemplate.expire(key, SESSION_TTL);
        return Boolean.TRUE.equals(added);
    }

    public Map<String, RhythmPlayerScore> findScores(String roomId) {
        Map<String, RhythmPlayerScore> out = new HashMap<>();
        redisTemplate.opsForHash().entries(scoresKey(roomId))
                .forEach((k, v) -> out.put((String) k, decode((String) k, (String) v)));
        return out;
    }

    public long countScores(String roomId) {
        Long size = redisTemplate.opsForHash().size(scoresKey(roomId));
        return size == null ? 0 : size;
    }

    // ── 인코딩 ─────────────────────────────────────────────

    private String encode(RhythmPlayerScore s) {
        return "nickname=" + URLEncoder.encode(s.nickname(), StandardCharsets.UTF_8)
                + "&score=" + s.score()
                + "&maxCombo=" + s.maxCombo()
                + "&perfect=" + s.perfect()
                + "&good=" + s.good()
                + "&miss=" + s.miss()
                + "&finishedAt=" + s.finishedAt();
    }

    private RhythmPlayerScore decode(String userId, String encoded) {
        Map<String, String> parts = new HashMap<>();
        for (String pair : encoded.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                parts.put(pair.substring(0, eq), pair.substring(eq + 1));
            }
        }
        return new RhythmPlayerScore(
                userId,
                parts.containsKey("nickname")
                        ? URLDecoder.decode(parts.get("nickname"), StandardCharsets.UTF_8)
                        : "",
                intOf(parts.get("score")),
                intOf(parts.get("maxCombo")),
                intOf(parts.get("perfect")),
                intOf(parts.get("good")),
                intOf(parts.get("miss")),
                longOf(parts.get("finishedAt")));
    }

    private static String str(Map<Object, Object> fields, String name) {
        Object v = fields.get(name);
        return v == null ? null : v.toString();
    }

    private static long num(Map<Object, Object> fields, String name, long fallback) {
        return longOfOr(str(fields, name), fallback);
    }

    private static int intOf(String raw) {
        return (int) longOf(raw);
    }

    private static long longOf(String raw) {
        return longOfOr(raw, 0L);
    }

    private static long longOfOr(String raw, long fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private String sessionKey(String roomId) {
        return "rhythm:session:" + roomId;
    }

    private String scoresKey(String roomId) {
        return "rhythm:session:" + roomId + ":scores";
    }

    private String endedKey(String roomId, String sessionId) {
        return "rhythm:session:" + roomId + ":ended:" + sessionId;
    }
}
