package ssafy.a706.backend.auth.store;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.RedisSystemException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;

/**
 * Redis 키맵 v0.3 — auth:refresh:{userId} Hash (TTL 14d).
 * 로그아웃 시 DEL이 곧 서버측 무효화이며, 갱신 시 회전(rotation)해 이전 토큰을 못 쓰게 만든다.
 *
 * <p><b>원문이 아니라 해시를 저장한다.</b> Redis는 DB와 달리 인증 없이 붙는 일이 잦고(로컬·컨테이너
 * 네트워크), 덤프·{@code MONITOR}·백업 어디로든 값이 새면 원문 저장 시에는 그 자체로 남의 세션을
 * 되살릴 수 있는 자격증명이 된다. 해시만 있으면 재발급을 받을 수 없다.
 * bcrypt가 아니라 SHA-256인 이유 — 대상이 서명된 JWT(고엔트로피 난수)라 사전 공격 대상이 아니고,
 * 갱신은 요청 경로에 있어 느린 해시를 걸 이유가 없다. 비밀번호(저엔트로피)와는 조건이 다르다.</p>
 *
 * <h3>필드</h3>
 * <ul>
 *   <li>{@code hash} — 지금 유효한 토큰의 해시</li>
 *   <li>{@code prevHash}/{@code prevUntil} — 직전 토큰과 그 유예 만료 시각(epoch ms). 아래 grace 참고</li>
 *   <li>{@code persistent} — 로그인 시 rememberMe 여부. 회전할 때 쿠키 수명을 원래대로 다시 세우는 데 쓴다</li>
 *   <li>{@code sid} — 이 세션의 ID(JWT sid claim과 동일). 회전을 거쳐도 유지되며,
 *       밀어내기·로그아웃이 폐기 목록에 올릴 대상을 여기서 읽는다(SessionRevocationStore)</li>
 * </ul>
 *
 * <h3>sid 가드 — 밀려난 기기의 갱신이 현 세션을 지우면 안 된다</h3>
 * 단일 세션이라 새 로그인이 이 키를 통째로 덮어쓴다(save). 밀려난 옛 기기의 스케줄러가 그 뒤에
 * 옛 토큰으로 갱신을 시도하면, 해시만 보던 시절엔 "모르는 토큰 = 유출"로 오인해 <b>새 로그인의
 * 세션까지 지웠다</b>. 그래서 회전 스크립트는 저장된 sid와 제시된 토큰의 sid가 다르면 재사용
 * 판정(DEL) 없이 그냥 거절한다(NONE) — 남의 세션 토큰은 유출 증거가 아니라 그저 남의 것이다.
 *
 * <h3>재사용 탐지와 grace</h3>
 * 회전 뒤에도 옛 토큰이 다시 오면 둘 중 하나다 — (a) 유출된 토큰을 누가 쓰고 있거나,
 * (b) 우리 클라이언트의 갱신 요청 두 개가 겹쳐 날아갔거나. (b)를 (a)로 오인해 세션을 끊으면
 * 탭을 두 개 열어 둔 것만으로 로그아웃되므로, 회전 직후 {@link #GRACE} 동안은 직전 토큰도 받아 준다.
 * 그 창을 넘겨서 온 옛 토큰은 (a)로 보고 <b>세션 자체를 지운다</b> — 훔친 쪽도 원래 주인도 재발급을 못 받는다.
 *
 * <p>검사와 회전은 Lua 한 덩어리로 돈다. 나눠 실행하면 동시에 들어온 두 갱신이 모두 "일치"를 보고
 * 각자 회전해, 나중에 저장된 쪽만 살아남고 클라이언트가 든 토큰은 죽는다 —
 * 다음 갱신에서 그게 재사용으로 잡히는 자기 발등 찍기가 된다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RefreshTokenStore {

    private static final String KEY = "auth:refresh:";

    private static final String FIELD_HASH = "hash";
    private static final String FIELD_PREV_HASH = "prevHash";
    private static final String FIELD_PREV_UNTIL = "prevUntil";
    private static final String FIELD_PERSISTENT = "persistent";
    private static final String FIELD_SESSION = "sid";

    /** 회전 직후 직전 토큰도 받아 주는 시간. 겹쳐 날아간 갱신 요청을 재사용으로 오인하지 않을 만큼만 짧게 잡는다. */
    public static final Duration GRACE = Duration.ofSeconds(30);

    /** 갱신 요청에 실려 온 토큰을 어떻게 판정했는가. */
    public enum Verdict {
        /** 현재 토큰이 맞다 — 회전까지 마쳤다. 새 토큰을 내려보내면 된다. */
        ROTATED,
        /** 방금 회전된 직전 토큰이다(동시 요청). 회전하지 않았으니 쿠키는 그대로 두고 액세스 토큰만 내준다. */
        GRACE,
        /** 모르는 토큰 — 재사용으로 보고 세션을 지웠다. */
        REUSED,
        /** 저장된 세션이 없다(로그아웃·만료). */
        NONE
    }

    private static final Verdict[] VERDICTS = {Verdict.NONE, Verdict.ROTATED, Verdict.GRACE, Verdict.REUSED};

    /**
     * KEYS[1]=키, ARGV[1]=제시된 토큰 해시, ARGV[2]=새 토큰 해시,
     * ARGV[3]=현재 시각(ms), ARGV[4]=grace 만료(ms), ARGV[5]=키 TTL(ms), ARGV[6]=제시된 토큰의 sid(없으면 빈 문자열).
     * 반환 0=NONE, 1=ROTATED, 2=GRACE, 3=REUSED — {@link #VERDICTS} 순서와 같다.
     * sid 가드(클래스 주석)가 맨 앞에 선다 — 다른 세션의 토큰은 재사용 판정(DEL)에 닿기 전에 걸러야 한다.
     * 저장된 sid가 없으면(도입 이전 세션) 가드를 건너뛰어 기존 세션을 깨지 않는다.
     */
    private static final RedisScript<Long> ROTATE = new DefaultRedisScript<>("""
            local sid = redis.call('HGET', KEYS[1], 'sid')
            if sid and sid ~= ARGV[6] then return 0 end
            local current = redis.call('HGET', KEYS[1], 'hash')
            if not current then return 0 end
            if current == ARGV[1] then
              redis.call('HSET', KEYS[1], 'hash', ARGV[2], 'prevHash', ARGV[1], 'prevUntil', ARGV[4])
              redis.call('PEXPIRE', KEYS[1], ARGV[5])
              return 1
            end
            local prev = redis.call('HGET', KEYS[1], 'prevHash')
            local prevUntil = redis.call('HGET', KEYS[1], 'prevUntil')
            if prev == ARGV[1] and prevUntil and tonumber(prevUntil) > tonumber(ARGV[3]) then
              return 2
            end
            redis.call('DEL', KEYS[1])
            return 3
            """, Long.class);

    private final StringRedisTemplate redis;

    /**
     * 로그인·소셜 로그인으로 세션을 새로 연다. 이전 회전 기록(prev*)까지 통째로 버려야
     * 옛 세션의 직전 토큰이 grace를 타고 되살아나지 않는다.
     */
    public void save(Long userId, String refreshToken, Duration ttl, boolean persistent, String sessionId) {
        String key = KEY + userId;
        redis.delete(key);
        redis.opsForHash().put(key, FIELD_HASH, hash(refreshToken));
        redis.opsForHash().put(key, FIELD_PERSISTENT, persistent ? "1" : "0");
        redis.opsForHash().put(key, FIELD_SESSION, sessionId);
        redis.expire(key, ttl);
    }

    /**
     * 제시된 토큰을 검사하고, 현재 토큰이면 그 자리에서 새 토큰으로 회전시킨다.
     * {@link Verdict#ROTATED}일 때만 {@code next}가 저장된다 — 그 외에는 저장 상태가 바뀌지 않거나(GRACE),
     * 세션이 지워진다(REUSED). {@code presentedSessionId}는 제시된 토큰의 sid claim —
     * 저장된 sid와 다르면 밀려난 옛 세션의 토큰이므로 아무것도 건드리지 않고 거절한다(NONE).
     */
    public Verdict rotate(Long userId, String presented, String next, Duration ttl, String presentedSessionId) {
        long now = System.currentTimeMillis();
        Long code = redis.execute(ROTATE, List.of(KEY + userId),
                hash(presented),
                hash(next),
                String.valueOf(now),
                String.valueOf(now + GRACE.toMillis()),
                String.valueOf(ttl.toMillis()),
                presentedSessionId == null ? "" : presentedSessionId);
        return VERDICTS[code == null ? 0 : code.intValue()];
    }

    /** 현재 세션의 ID(sid). 세션이 없거나 sid 도입 이전에 열린 세션이면 null. */
    public String sessionId(Long userId) {
        try {
            Object stored = redis.opsForHash().get(KEY + userId, FIELD_SESSION);
            return stored == null ? null : stored.toString();
        } catch (RedisSystemException e) {
            // 해시 도입(키맵 v0.3) 전의 평문 String 키가 남아 있으면 HGET이 WRONGTYPE으로 터진다.
            // 로그인 경로가 이 조회를 save()보다 먼저 타므로 여기서 던지면 그 사용자는 로그인 자체가
            // 막힌다 — sid 없는 레거시 세션으로 취급하고 넘어간다. 로그인이 이어지면 save()가
            // 키를 지우고 해시로 다시 써서 스스로 치유된다.
            log.warn("auth:refresh:{} 구 포맷 키 감지 — sid 없음으로 취급한다 (로그인 시 해시로 재작성됨)", userId);
            return null;
        }
    }

    /** 로그인 때 고른 rememberMe — 회전 시 쿠키 수명을 원래대로 유지하려고 읽는다. */
    public boolean isPersistent(Long userId) {
        Object stored = redis.opsForHash().get(KEY + userId, FIELD_PERSISTENT);
        return stored != null && "1".equals(stored.toString());
    }

    public void delete(Long userId) {
        redis.delete(KEY + userId);
    }

    private String hash(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", e);
        }
    }
}
