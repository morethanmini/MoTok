package ssafy.a706.backend.auth.password;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 비밀번호 재설정 토큰 저장소 — Redis auth:pwreset:{token} → userId (TTL 30m).
 * 재설정 시 getAndDelete로 1회만 소비한다.
 */
@Component
@RequiredArgsConstructor
public class PwResetTokenStore {

    private static final String KEY = "auth:pwreset:";

    private final StringRedisTemplate redis;

    public void save(String token, Long userId, Duration ttl) {
        redis.opsForValue().set(KEY + token, String.valueOf(userId), ttl);
    }

    /** 토큰을 소비(getAndDelete)하고 userId를 반환한다. 없거나 만료면 null. */
    public Long consume(String token) {
        String value = redis.opsForValue().getAndDelete(KEY + token);
        return value == null ? null : Long.valueOf(value);
    }
}
