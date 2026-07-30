package ssafy.a706.backend.auth.session;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
 * <p>TTL은 Access 수명 + 여유 — 그 뒤에는 토큰 자체가 만료돼 목록에 남아 있을 이유가 없다.</p>
 *
 * <p><b>조회는 fail-open이다</b> — 레디스가 죽어 {@link #reasonOf}가 답을 못 얻으면 "폐기되지 않았다"로
 * 본다(null). 가용성을 지키는 대신 폐기 반영이 최대 Access 수명만큼 늦는 것을 감수하는 선택이다.
 * 반대로 하면 레디스 장애가 곧 전면 인증 장애가 된다. 이 판단을 <b>스토어 안에 두는 이유</b>는
 * 호출자가 셋(REST 필터·토큰 갱신·STOMP CONNECT)이라, 각자 try/catch를 들면 한 곳만 빠뜨려도
 * 그 경로만 장애 시 500을 내며 정책이 갈리기 때문이다. 실제로 그렇게 갈렸던 적이 있다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SessionRevocationStore {

    private static final String KEY = "auth:revoked-sid:";

    /** 클라이언트-서버 시계 오차·발급 직전 경합을 덮을 여유분. */
    private static final Duration EXTRA_TTL = Duration.ofMinutes(1);

    /**
     * 왜 폐기됐는가. 차단 여부는 사유와 무관하게 같고, {@code DISPLACED}만 클라이언트에 전용 코드
     * (AUTH_SESSION_DISPLACED)로 구분해 내려간다 — "다른 곳에서 로그인"은 계정 도용을 알아챌 신호라
     * 일반 만료와 문구가 달라야 하기 때문이다. 나머지는 모두 일반 401이다.
     * 그래도 사유를 나눠 적는 것은 이 값이 Redis에 남아 "이 세션이 왜 죽었나"를 사후에 말해 주기 때문이다.
     */
    public enum Reason {
        /** 같은 계정의 새 로그인이 이 세션을 밀어냈다(단일 세션). */
        DISPLACED,
        /** 본인이 로그아웃했다 — 남은 토큰이 있다면 그건 본인이 아니다. */
        LOGGED_OUT,
        /** 비밀번호가 바뀌었다(변경·재설정) — 옛 비밀번호로 열린 세션은 더 이상 유효하지 않다. */
        CREDENTIALS_CHANGED,
        /** 계정이 탈퇴했다 — 남은 토큰이 가리키는 사용자가 이제 없다. */
        WITHDRAWN,
        /**
         * 회전된 Refresh 토큰이 grace를 넘겨 다시 왔다 — 유출로 본다(RefreshTokenStore의 재사용 탐지).
         * 우리가 세션을 죽이는 사유 중 <b>유일하게 사용자의 행동이 아닌</b> 것이라, 사후에
         * "이 세션이 왜 죽었나"를 되짚을 때 나머지와 반드시 구분돼야 한다.
         */
        TOKEN_REUSED
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
        revoke(refreshTokenStore.sessionId(userId), reason);
    }

    /**
     * sid를 직접 받아 폐기한다 — Refresh 해시에서 더 이상 읽을 수 없을 때를 위한 문이다.
     *
     * <p>재사용 탐지가 그렇다. {@code RefreshTokenStore}의 회전 스크립트는 유출로 판정한 순간
     * 해시를 통째로 DEL 하므로, 그 뒤에 {@link #revokeCurrent}를 부르면 읽을 sid가 없어 조용히
     * 아무 일도 하지 않는다. 호출자가 제시된 토큰에서 이미 파싱해 둔 sid를 그대로 넘긴다.</p>
     *
     * <p>{@code sid}가 null이면 아무것도 하지 않는다 — sid 도입 이전 토큰에는 폐기할 대상이 없다.
     * 호출자마다 null 검사를 두는 대신 여기서 한 번 접는다.</p>
     */
    public void revoke(String sid, Reason reason) {
        if (sid == null) {
            return;
        }
        redis.opsForValue().set(KEY + sid, reason.name(),
                Duration.ofMillis(tokenProvider.getAccessExpirationMs()).plus(EXTRA_TTL));
    }

    /**
     * 폐기된 세션이면 그 사유, 아니면 null. 조회에 실패해도 예외를 던지지 않고 null을 준다 —
     * 클래스 주석의 fail-open이 여기서 구현된다. 배포 중 새 인스턴스가 쓴 사유를 옛 인스턴스가 읽어
     * {@code valueOf}가 터지는 경우까지 같은 문으로 덮인다.
     */
    public Reason reasonOf(String sid) {
        try {
            String stored = redis.opsForValue().get(KEY + sid);
            return stored == null ? null : Reason.valueOf(stored);
        } catch (RuntimeException e) {
            log.warn("세션 폐기 목록 조회 실패 — 폐기되지 않은 것으로 본다(fail-open) sid={}", sid, e);
            return null;
        }
    }
}
