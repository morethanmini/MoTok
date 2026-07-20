package ssafy.a706.backend.auth.store;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Redis 키맵 v0.2 — auth:refresh:{userId} (TTL 14d).
 * 로그아웃 시 DEL이 곧 서버측 무효화이며, 갱신 시 회전(rotation)해 이전 토큰을 못 쓰게 만든다.
 */
@Component
@RequiredArgsConstructor
public class RefreshTokenStore {

    private static final String KEY = "auth:refresh:";

    private final StringRedisTemplate redis;

    public void save(Long userId, String refreshToken, Duration ttl) {
        redis.opsForValue().set(KEY + userId, refreshToken, ttl);
    }

    /** 저장된 토큰과 일치하는지 — 탈취·재사용된 옛 토큰을 걸러낸다. */
    public boolean matches(Long userId, String refreshToken) {
        String stored = redis.opsForValue().get(KEY + userId);
        return stored != null && stored.equals(refreshToken);
    }

    public void delete(Long userId) {
        redis.delete(KEY + userId);
    }
}
