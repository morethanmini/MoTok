package ssafy.a706.backend.auth.ratelimit;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 게스트 시작 호출 제한 — 호출마다 24시간짜리 방이 생기는 비인증 엔드포인트를 IP로 막는다.
 *
 * <p>운영은 nginx 뒤라 진짜 IP는 X-Forwarded-For에 있는데, nginx가 <b>뒤에 덧붙이는</b> 방식이라
 * 앞부분은 클라이언트가 위조할 수 있다. 마지막 항목을 봐야 한도를 우회당하지 않는다.</p>
 */
class GuestStartLimiterTest {

    private static final String IP = "203.0.113.9";

    private final ValueOperations<String, String> valueOps = mock(ValueOperations.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final HttpServletRequest request = mock(HttpServletRequest.class);
    private final RateLimitProperties properties =
            new RateLimitProperties(5, Duration.ofMinutes(30), 10, 100);
    private final GuestStartLimiter limiter = new GuestStartLimiter(redis, properties);

    @BeforeEach
    void stubOps() {
        given(redis.opsForValue()).willReturn(valueOps);
        given(request.getRemoteAddr()).willReturn(IP);
    }

    private void counts(long perMinute, long perHour) {
        given(valueOps.increment("auth:guest:start:m:" + IP)).willReturn(perMinute);
        given(valueOps.increment("auth:guest:start:h:" + IP)).willReturn(perHour);
    }

    @Test
    @DisplayName("한도 안이면 통과한다")
    void allowsWithinLimit() {
        counts(10, 100); // 딱 한도까지는 허용

        assertThatCode(() -> limiter.ensureAllowed(request)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("분당 한도를 넘으면 429")
    void rejectsBurst() {
        counts(11, 20);

        assertThatThrownBy(() -> limiter.ensureAllowed(request))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.GUEST_START_LIMIT_EXCEEDED);
    }

    @Test
    @DisplayName("분당은 여유가 있어도 시간당 한도를 넘으면 429 — 한도에 맞춰 계속 두드리는 공격을 막는다")
    void rejectsSustained() {
        counts(1, 101);

        assertThatThrownBy(() -> limiter.ensureAllowed(request))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("창의 첫 호출에만 TTL을 건다")
    void setsWindowOnFirstHit() {
        counts(1, 1);

        limiter.ensureAllowed(request);

        verify(redis).expire("auth:guest:start:m:" + IP, Duration.ofMinutes(1));
        verify(redis).expire("auth:guest:start:h:" + IP, Duration.ofHours(1));
    }

    @Test
    @DisplayName("X-Forwarded-For는 마지막 항목을 쓴다 — 앞쪽은 클라이언트가 위조할 수 있다")
    void usesLastForwardedHop() {
        given(request.getHeader("X-Forwarded-For")).willReturn("1.1.1.1, 2.2.2.2, " + IP);
        counts(1, 1);

        limiter.ensureAllowed(request);

        // 위조된 앞 항목이 아니라 nginx가 본 주소로 카운트되어야 한다
        verify(valueOps).increment("auth:guest:start:m:" + IP);
    }

    @Test
    @DisplayName("Redis가 답을 못 주면 막지 않는다 — 인증 장애가 서비스 장애가 되면 안 된다")
    void allowsWhenCounterUnavailable() {
        given(valueOps.increment("auth:guest:start:m:" + IP)).willReturn(null);
        given(valueOps.increment("auth:guest:start:h:" + IP)).willReturn(null);

        assertThatCode(() -> limiter.ensureAllowed(request)).doesNotThrowAnyException();
    }
}
