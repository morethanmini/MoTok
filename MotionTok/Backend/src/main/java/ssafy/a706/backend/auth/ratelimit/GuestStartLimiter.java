package ssafy.a706.backend.auth.ratelimit;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.time.Duration;

/**
 * 게스트 시작(POST /auth/guest) 호출 제한 — IP 기준.
 *
 * <p>이 엔드포인트는 로그인 없이 누구나 부를 수 있는데, 한 번 부를 때마다 Redis에 <b>24시간짜리
 * 1인방</b>이 하나씩 생긴다(LiveRoomService.createGuestSoloRoom). 제한이 없으면 스크립트 하나로
 * 쓰레기 방을 무한정 쌓을 수 있다. 토큰 발급은 서버에 아무것도 남기지 않으므로, 막아야 하는 건
 * <b>방을 만드는 호출 빈도</b>다.</p>
 *
 * <h4>분·시간 두 창을 함께 보는 이유</h4>
 * 분당 한도만 두면 그 한도에 딱 맞춰 계속 두드리는 공격이 통하고, 시간당 한도만 두면 한 번에
 * 몰아치는 폭주를 초반에 못 잡는다. 이메일 인증이 쿨다운(60초)과 1일 한도(5회)를 함께 두는 것과 같은 모양이다.
 *
 * <h4>한도를 넉넉히 잡은 이유</h4>
 * 학원·사내망처럼 <b>여러 사람이 같은 공인 IP를 공유</b>하는 곳이 이 서비스의 주 사용처다.
 * 한 명 기준으로 빡빡하게 잡으면 같은 강의실에서 동시에 눌렀다는 이유로 막힌다.
 * 스크립트는 분당 수천 번을 던지므로 사람 수십 명분으로 잡아도 공격과는 자릿수가 다르다.
 *
 * <p>Redis 키 — {@code auth:guest:start:m:{ip}}(TTL 1m), {@code auth:guest:start:h:{ip}}(TTL 1h).</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GuestStartLimiter {

    private static final String KEY_MINUTE = "auth:guest:start:m:";
    private static final String KEY_HOUR = "auth:guest:start:h:";

    private final StringRedisTemplate redis;
    private final RateLimitProperties properties;

    /** 게스트 세션을 만들기 전에 부른다. 한도를 넘으면 429. */
    public void ensureAllowed(HttpServletRequest request) {
        String ip = clientIp(request);
        boolean overMinute = hit(KEY_MINUTE + ip, Duration.ofMinutes(1)) > properties.guestPerMinute();
        boolean overHour = hit(KEY_HOUR + ip, Duration.ofHours(1)) > properties.guestPerHour();
        if (overMinute || overHour) {
            log.warn("게스트 시작 한도 초과 — ip={} ({})", ip, overMinute ? "분당" : "시간당");
            throw new BusinessException(ErrorCode.GUEST_START_LIMIT_EXCEEDED);
        }
    }

    /** 고정 창 카운터 — 창의 첫 호출에만 TTL을 건다. */
    private long hit(String key, Duration window) {
        Long count = redis.opsForValue().increment(key);
        if (count == null) {
            return 0; // Redis가 답을 못 주면 막지 않는다 — 인증 장애가 서비스 장애가 되면 안 된다
        }
        if (count == 1L) {
            redis.expire(key, window);
        }
        return count;
    }

    /**
     * 클라이언트 IP.
     *
     * <p>운영은 nginx 뒤에 있어 {@code request.getRemoteAddr()}가 항상 nginx다. nginx가
     * {@code proxy_add_x_forwarded_for}로 넘기는 X-Forwarded-For는 "클라이언트가 보낸 값, 실제 접속 IP"
     * 형태라 <b>마지막 항목</b>이 nginx가 직접 본 주소다. 앞쪽은 클라이언트가 마음대로 채워 넣을 수 있어
     * 믿으면 한도를 그냥 우회당한다.</p>
     */
    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded == null || forwarded.isBlank()) {
            return request.getRemoteAddr();
        }
        String[] hops = forwarded.split(",");
        return hops[hops.length - 1].trim();
    }
}
