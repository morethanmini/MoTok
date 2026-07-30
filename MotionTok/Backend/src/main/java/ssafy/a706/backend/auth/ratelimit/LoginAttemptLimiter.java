package ssafy.a706.backend.auth.ratelimit;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.time.Duration;

/**
 * 로그인 실패 백오프 — 틀릴수록 점점 더 오래 막는다.
 *
 * <p>비밀번호는 사람이 외우는 값이라 무차별 대입에 약하다. 한도가 없으면 초당 수백 번을 던져
 * 흔한 비밀번호를 찾아낼 수 있는데, 시도 사이에 <b>기다리는 시간</b>만 넣어도 그 계산이 성립하지 않는다.
 * 오타 몇 번은 그냥 통과시키고({@code loginFailThreshold}), 그 뒤부터 1분 → 5분 → 15분으로 늘린다.</p>
 *
 * <h4>스레드를 재우지 않는다</h4>
 * "백오프"라고 서버가 {@code sleep}하면 그 요청이 톰캣 스레드를 붙잡고 있어, 공격자가 오히려
 * 스레드 풀을 고갈시키는 수단이 된다. 그래서 기다리게 하는 대신 <b>즉시 429로 거절</b>하고
 * 남은 시간은 Redis 키의 TTL이 센다.
 *
 * <h4>계정 기준으로 세는 것의 값과 대가</h4>
 * IP가 아니라 이메일로 세므로 IP를 바꿔 가며 던져도 한 계정에 대한 시도는 함께 누적된다 — 그게 이
 * 방어의 핵심이다. 대신 남의 이메일에 일부러 틀린 비밀번호를 던져 그 사람을 잠시 막는 괴롭힘이
 * 가능해진다. 그래서 차단은 <b>최대 15분으로 끊고</b> 영구 잠금은 두지 않았다.
 * (계정이 아니라 IP까지 막고 싶어지면 여기 카운터를 하나 더 얹으면 된다.)
 *
 * <p>Redis 키 — {@code auth:login:fail:{email}}(카운터), {@code auth:login:block:{email}}(차단 마커).</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LoginAttemptLimiter {

    private static final String KEY_FAIL = "auth:login:fail:";
    private static final String KEY_BLOCK = "auth:login:block:";

    /** 임계를 넘긴 뒤 실패가 쌓일수록 길어지는 차단 시간. 마지막 값이 상한이다. */
    private static final Duration[] BACKOFF = {
            Duration.ofMinutes(1),   // 임계 ~ 임계+4회
            Duration.ofMinutes(5),   // 그 다음 10회
            Duration.ofMinutes(15),  // 이후 계속
    };

    private final StringRedisTemplate redis;
    private final RateLimitProperties properties;

    /** 비밀번호를 검사하기 <b>전에</b> 부른다 — 차단 중이면 검사 자체를 하지 않는다. */
    public void ensureNotBlocked(String email) {
        if (Boolean.TRUE.equals(redis.hasKey(KEY_BLOCK + email))) {
            throw new BusinessException(ErrorCode.LOGIN_ATTEMPTS_EXCEEDED);
        }
    }

    /** 비밀번호가 틀렸을 때. 임계를 넘으면 차단 마커를 심는다. */
    public void recordFailure(String email) {
        String failKey = KEY_FAIL + email;
        Long fails = redis.opsForValue().increment(failKey);
        if (fails == null) {
            return;
        }
        if (fails == 1L) {
            redis.expire(failKey, properties.loginFailWindow());
        }
        if (fails < properties.loginFailThreshold()) {
            return;
        }
        Duration block = backoffFor(fails - properties.loginFailThreshold());
        redis.opsForValue().set(KEY_BLOCK + email, "1", block);
        log.warn("로그인 실패 누적 — {}회, {}분 차단 (email={})", fails, block.toMinutes(), email);
    }

    /** 로그인 성공. 다음 사람이 처음부터 시작하도록 흔적을 지운다. */
    public void reset(String email) {
        redis.delete(java.util.List.of(KEY_FAIL + email, KEY_BLOCK + email));
    }

    private Duration backoffFor(long over) {
        if (over < 5) {
            return BACKOFF[0];
        }
        if (over < 15) {
            return BACKOFF[1];
        }
        return BACKOFF[2];
    }
}
