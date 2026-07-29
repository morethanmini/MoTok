package ssafy.a706.backend.auth.session;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.auth.store.RefreshTokenStore;

import java.time.Duration;

/**
 * 세션(sid) 폐기 목록 — 이미 발급된 Access 토큰을 만료 전에 죽이는 스위치.
 *
 * <p>Access 토큰은 무상태라 서버가 회수할 수단이 없었다. 밀어내기·로그아웃이 Refresh를 지워도
 * 옛 기기의 Access는 만료(30분)까지 살아 방 생성·입장·SFU 토큰 발급을 계속할 수 있었다(-157 후속).
 * 그래서 로그인마다 부여되는 세션 ID(sid claim)를 열쇠로, 끊어야 할 세션만
 * {@code auth:revoked-sid:{sid}}에 사유와 함께 올린다.</p>
 *
 * <p><b>화이트리스트가 아니라 블랙리스트인 이유</b> — 모든 요청이 Redis를 거치는 것은 같지만,
 * 존재 확인 대상이 "살아 있는 세션 전부"가 아니라 "죽인 세션"뿐이라 쓰기가 폐기 사건 때만 일어나고,
 * sid 도입 이전 토큰·게스트 토큰(sid 없음)이 자연스럽게 통과해 배포 경계에서 아무도 끊기지 않는다.</p>
 *
 * <p>TTL은 Access 수명 + 여유 — 그 뒤에는 토큰 자체가 만료돼 목록에 남아 있을 이유가 없다.
 * 이 목록 조회가 실패하면(레디스 장애) 호출자는 서명 검증만으로 통과시킨다(fail-open) —
 * 가용성을 지키는 대신 폐기가 최대 Access 수명만큼 늦는 것을 감수하는 선택이고, 로그로 흔적을 남긴다.</p>
 */
@Component
@RequiredArgsConstructor
public class SessionRevocationStore {

    private static final String KEY = "auth:revoked-sid:";

    /** 클라이언트-서버 시계 오차·발급 직전 경합을 덮을 여유분. */
    private static final Duration EXTRA_TTL = Duration.ofMinutes(1);

    /** 왜 폐기됐는가 — DISPLACED만 클라이언트에 전용 코드(AUTH_SESSION_DISPLACED)로 구분해 내려간다. */
    public enum Reason {
        /** 같은 계정의 새 로그인이 이 세션을 밀어냈다(단일 세션). */
        DISPLACED,
        /** 본인이 로그아웃했다 — 남은 토큰이 있다면 그건 본인이 아니다. */
        LOGGED_OUT
    }

    private final StringRedisTemplate redis;
    private final RefreshTokenStore refreshTokenStore;
    private final JwtTokenProvider tokenProvider;

    /**
     * 지금 열려 있는 세션을 폐기 목록에 올린다. sid는 Refresh 해시에서 읽으므로
     * <b>Refresh를 지우거나 덮어쓰기 전에</b> 불러야 한다.
     * sid 도입 이전 세션(필드 없음)은 올릴 수 없다 — 종전처럼 Access 만료를 기다린다.
     */
    public void revokeCurrent(Long userId, Reason reason) {
        String sid = refreshTokenStore.sessionId(userId);
        if (sid == null) {
            return;
        }
        redis.opsForValue().set(KEY + sid, reason.name(),
                Duration.ofMillis(tokenProvider.getAccessExpirationMs()).plus(EXTRA_TTL));
    }

    /** 폐기된 세션이면 그 사유, 아니면 null. */
    public Reason reasonOf(String sid) {
        String stored = redis.opsForValue().get(KEY + sid);
        return stored == null ? null : Reason.valueOf(stored);
    }
}
