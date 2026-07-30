package ssafy.a706.backend.chat;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.time.Duration;

/**
 * 채팅 도배 방지 — 유저당 5초 창에 5건까지만 허용한다(S15P11A706-159).
 *
 * <p>채팅은 /topic 브로드캐스트라 한 명이 도배하면 방 전원의 화면·Redis Stream이 함께 오염된다.
 * 500자 상한(대용량 프레임)만으로는 <b>빈도</b> 남용을 못 막아서 전송 횟수를 제한한다.</p>
 *
 * <p>키는 방이 아니라 유저 기준({@code chat:rate:{userId}}) — 방을 옮겨 다니며 도배하는 것도
 * 같은 카운터로 잡힌다. 고정 창 카운터라 창 경계에서 최대 2배 버스트가 이론상 가능하지만,
 * 도배 체감을 막는 데는 충분하고 구현이 단순하다(GuestStartLimiter와 같은 모양).
 * Redis 장애 시에는 막지 않는다 — 리밋 장애가 채팅 장애가 되면 안 된다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChatRateLimiter {

    private static final String KEY_PREFIX = "chat:rate:";

    /** 창 크기·허용 건수 — 프론트 선차단(GameRoomView)과 같은 값을 쓴다. */
    private static final Duration WINDOW = Duration.ofSeconds(5);
    private static final int MAX_PER_WINDOW = 5;

    private final StringRedisTemplate redis;

    /** 채팅·게임 제안을 브로드캐스트하기 전에 부른다. 한도를 넘으면 429. */
    public void ensureAllowed(String userId) {
        String key = KEY_PREFIX + userId;
        Long count = redis.opsForValue().increment(key);
        if (count == null) {
            return;
        }
        if (count == 1L) {
            redis.expire(key, WINDOW);
        }
        if (count > MAX_PER_WINDOW) {
            log.warn("채팅 도배 한도 초과 — userId={}, count={}", userId, count);
            throw new BusinessException(ErrorCode.CHAT_RATE_LIMITED);
        }
    }
}
