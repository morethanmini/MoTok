package ssafy.a706.backend.auth.ratelimit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 로그인 실패 백오프 — 틀릴수록 오래 막는다.
 *
 * <p>임계 전까지는 <b>차단 마커를 만들지 않는 것</b>이 중요하다. 오타 한 번에 잠기면
 * 정상 사용자가 먼저 나가떨어진다.</p>
 */
class LoginAttemptLimiterTest {

    private static final String EMAIL = "me@motok.com";
    private static final String FAIL_KEY = "auth:login:fail:me@motok.com";
    private static final String BLOCK_KEY = "auth:login:block:me@motok.com";

    private final ValueOperations<String, String> valueOps = mock(ValueOperations.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final RateLimitProperties properties =
            new RateLimitProperties(5, Duration.ofMinutes(30), 10, 100);
    private final LoginAttemptLimiter limiter = new LoginAttemptLimiter(redis, properties);

    @BeforeEach
    void stubOps() {
        given(redis.opsForValue()).willReturn(valueOps);
    }

    /** n번째 실패로 만든다. */
    private void failureNumber(long n) {
        given(valueOps.increment(FAIL_KEY)).willReturn(n);
        limiter.recordFailure(EMAIL);
    }

    /** 차단 마커에 실린 TTL. 마커를 안 만들었으면 null. */
    private Duration blockedFor() {
        ArgumentCaptor<Duration> ttl = ArgumentCaptor.forClass(Duration.class);
        try {
            verify(valueOps).set(eq(BLOCK_KEY), anyString(), ttl.capture());
        } catch (AssertionError notBlocked) {
            return null;
        }
        return ttl.getValue();
    }

    @Test
    @DisplayName("차단 마커가 있으면 429로 막는다")
    void blocksWhenMarkerExists() {
        given(redis.hasKey(BLOCK_KEY)).willReturn(true);

        assertThatThrownBy(() -> limiter.ensureNotBlocked(EMAIL))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.LOGIN_ATTEMPTS_EXCEEDED);
    }

    @Test
    @DisplayName("마커가 없으면 그냥 통과한다")
    void passesWithoutMarker() {
        given(redis.hasKey(BLOCK_KEY)).willReturn(false);

        assertThatCode(() -> limiter.ensureNotBlocked(EMAIL)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("임계 전 실패는 세기만 하고 막지 않는다 — 오타로 잠기면 안 된다")
    void countsWithoutBlockingBelowThreshold() {
        failureNumber(4);

        assertThat(blockedFor()).isNull();
    }

    @Test
    @DisplayName("첫 실패에만 카운터 수명을 건다 — 조용해지면 처음부터 다시 센다")
    void setsWindowOnFirstFailureOnly() {
        failureNumber(1);
        verify(redis).expire(FAIL_KEY, Duration.ofMinutes(30));

        failureNumber(2);
        verify(redis).expire(eq(FAIL_KEY), any(Duration.class)); // 여전히 1회뿐
    }

    @Test
    @DisplayName("임계를 넘으면 1분 → 5분 → 15분으로 길어진다")
    void backsOffProgressively() {
        assertThat(blockDurationAt(5)).isEqualTo(Duration.ofMinutes(1));   // 임계 도달
        assertThat(blockDurationAt(9)).isEqualTo(Duration.ofMinutes(1));
        assertThat(blockDurationAt(10)).isEqualTo(Duration.ofMinutes(5));
        assertThat(blockDurationAt(19)).isEqualTo(Duration.ofMinutes(5));
        assertThat(blockDurationAt(20)).isEqualTo(Duration.ofMinutes(15));
        assertThat(blockDurationAt(500)).isEqualTo(Duration.ofMinutes(15)); // 상한
    }

    @Test
    @DisplayName("성공하면 카운터와 차단을 함께 지운다")
    void resetsBothKeys() {
        limiter.reset(EMAIL);

        verify(redis).delete(java.util.List.of(FAIL_KEY, BLOCK_KEY));
    }

    @Test
    @DisplayName("Redis가 카운터를 돌려주지 않으면 막지 않는다 — 인증 장애가 서비스 장애가 되면 안 된다")
    void doesNotBlockWhenCounterUnavailable() {
        given(valueOps.increment(FAIL_KEY)).willReturn(null);

        limiter.recordFailure(EMAIL);

        verify(valueOps, never()).set(eq(BLOCK_KEY), anyString(), any(Duration.class));
    }

    /** 매번 새 mock으로 n번째 실패만 재현해 차단 시간을 읽는다. */
    private Duration blockDurationAt(long failCount) {
        ValueOperations<String, String> ops = mock(ValueOperations.class);
        StringRedisTemplate template = mock(StringRedisTemplate.class);
        given(template.opsForValue()).willReturn(ops);
        given(ops.increment(FAIL_KEY)).willReturn(failCount);

        new LoginAttemptLimiter(template, properties).recordFailure(EMAIL);

        ArgumentCaptor<Duration> ttl = ArgumentCaptor.forClass(Duration.class);
        verify(ops).set(eq(BLOCK_KEY), anyString(), ttl.capture());
        return ttl.getValue();
    }
}
