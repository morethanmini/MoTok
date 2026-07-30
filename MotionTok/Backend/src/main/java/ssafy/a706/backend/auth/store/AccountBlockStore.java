package ssafy.a706.backend.auth.store;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 계정 차단 저장소 — 기간 정지와 영구 정지를 한 곳에서 본다.
 *
 * <pre>
 * auth:suspended:{userId} → 사유 (TTL = 정지 기간)   기간 정지
 * auth:banned:{userId}    → 사유 (TTL 없음)          영구 정지
 * </pre>
 *
 * <p><b>기간 정지를 컬럼이 아니라 TTL로 두는 이유.</b> users에 만료 시각 컬럼을 두면 기간이 끝났을 때
 * 상태를 되돌려 줄 주체(배치·스케줄러)가 필요해지고, 그게 밀리거나 실패하면 이미 풀렸어야 할 계정이
 * 계속 막힌다. TTL은 그 복구 작업 자체를 없앤다 — 만료되면 키가 사라지고 그 순간 정지도 끝난다.
 * 남은 기간 조회도 TTL 한 번이라 별도 계산이 없다.</p>
 *
 * <p><b>영구 정지는 반대로 TTL을 걸지 않는다.</b> 스스로 풀려서는 안 되는 상태이므로 만료가 있으면
 * 오히려 버그다. 원천은 {@code users.status=BANNED}(RDB)이고 여기 있는 키는 <b>요청마다 도는 인증
 * 경로용 캐시</b>다 — Access 토큰은 서명만으로 유효해서(기본 1시간) DB를 보지 않으면 밴을 걸어도
 * 이미 발급된 토큰이 그대로 통한다. 되돌릴 주체가 필요하다는 문제는 생기지 않는다: 밴의 유일한
 * 전이는 관리자의 명시적 해제이고, 그때 상태와 이 키를 함께 지운다.</p>
 *
 * <p><b>users.status는 기간 정지에 쓰지 않는다.</b> SUSPENDED로 바꾸면 만료 때 ACTIVE로 되돌릴 주체가
 * 다시 필요해져 TTL을 쓰는 의미가 사라진다. 그 컬럼은 스스로 풀리지 않는 상태(BANNED·DELETED) 전용이다.</p>
 *
 * <p><b>여기 있는 건 "지금 막혀 있나"뿐이다.</b> 누가 언제 왜 몇 일을 걸었는지는
 * {@code SanctionHistory}(RDB)가 따로 남긴다 — TTL이 만료되면 흔적도 함께 사라지기 때문이다.</p>
 */
@Component
@RequiredArgsConstructor
public class AccountBlockStore {

    private static final String SUSPENDED_KEY = "auth:suspended:";
    private static final String BANNED_KEY = "auth:banned:";

    private final StringRedisTemplate redis;

    /** 기간 정지 부과. 이미 정지 중이면 새 기간·사유로 덮어쓴다(연장·정정이 곧 재부과다). */
    public void suspend(Long userId, String reason, Duration ttl) {
        redis.opsForValue().set(SUSPENDED_KEY + userId, reason, ttl);
    }

    /** 영구 정지 부과. TTL을 걸지 않는다 — 스스로 풀리면 안 되는 상태다. */
    public void ban(Long userId, String reason) {
        redis.opsForValue().set(BANNED_KEY + userId, reason);
    }

    /**
     * 지금 이 계정이 막혀 있는지, 막혔다면 어느 쪽인지.
     *
     * <p>요청마다 도는 경로(JwtAuthenticationFilter)라 <b>왕복 한 번</b>으로 끝낸다 —
     * EXISTS는 키를 여러 개 받아 존재하는 개수를 돌려주므로, 둘 다 없으면 0이고 그때가 대부분이다.
     * 하나라도 있으면 그때만 어느 쪽인지 한 번 더 확인한다.</p>
     *
     * <p>둘이 동시에 존재하면 <b>영구 정지가 이긴다</b> — 더 강한 제재이고, 밴을 걸 때 정지 키를
     * 지우므로 정상 경로에서는 겹치지 않는다(경합으로 겹쳤을 때의 안전한 기본값이다).</p>
     */
    public AccountBlock blockOf(Long userId) {
        Long existing = redis.countExistingKeys(List.of(SUSPENDED_KEY + userId, BANNED_KEY + userId));
        if (existing == null || existing == 0) {
            return AccountBlock.NONE;
        }
        return Boolean.TRUE.equals(redis.hasKey(BANNED_KEY + userId))
                ? AccountBlock.BANNED
                : AccountBlock.SUSPENDED;
    }

    /** 기간 정지 중인지. 관리 화면·해제 검증처럼 한쪽만 궁금할 때 쓴다. */
    public boolean isSuspended(Long userId) {
        return Boolean.TRUE.equals(redis.hasKey(SUSPENDED_KEY + userId));
    }

    /** 영구 정지 중인지. */
    public boolean isBanned(Long userId) {
        return Boolean.TRUE.equals(redis.hasKey(BANNED_KEY + userId));
    }

    /** 기간 정지 사유. 정지 중이 아니면 null. */
    public String suspendReason(Long userId) {
        return redis.opsForValue().get(SUSPENDED_KEY + userId);
    }

    /** 영구 정지 사유. 밴이 아니면 null. */
    public String banReason(Long userId) {
        return redis.opsForValue().get(BANNED_KEY + userId);
    }

    /**
     * 남은 기간 정지 시간. 정지 중이 아니면 null.
     * getExpire는 키가 없으면 -2, TTL이 없으면 -1을 준다 — 둘 다 "정지 아님"으로 접는다
     * (suspend가 항상 TTL을 걸므로 -1은 나올 수 없지만, 나온다면 무기한 정지가 되어 더 위험하다).
     */
    public Duration remaining(Long userId) {
        Long seconds = redis.getExpire(SUSPENDED_KEY + userId, TimeUnit.SECONDS);
        return seconds == null || seconds <= 0 ? null : Duration.ofSeconds(seconds);
    }

    /** 기간 정지 해제. 실제로 지워졌으면 true, 이미 만료·미정지였으면 false. */
    public boolean releaseSuspension(Long userId) {
        return Boolean.TRUE.equals(redis.delete(SUSPENDED_KEY + userId));
    }

    /** 영구 정지 해제. RDB의 status 복구와 함께 불려야 한다 — 한쪽만 지우면 두 원천이 어긋난다. */
    public boolean releaseBan(Long userId) {
        return Boolean.TRUE.equals(redis.delete(BANNED_KEY + userId));
    }
}
