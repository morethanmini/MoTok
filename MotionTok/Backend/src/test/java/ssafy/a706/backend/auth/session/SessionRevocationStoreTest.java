package ssafy.a706.backend.auth.session;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.auth.store.RefreshTokenStore;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 세션 폐기 목록 — 이미 나간 Access 토큰을 만료 전에 죽이는 스위치의 최소 계약.
 * sid는 Refresh 해시에서 읽으므로 "지우기 전에 폐기"라는 호출 순서는 호출자 테스트가 지킨다.
 */
class SessionRevocationStoreTest {

    private static final long USER_ID = 42L;
    private static final String SID = "sid-42-current";
    private static final String KEY = "auth:revoked-sid:" + SID;
    private static final long ACCESS_MS = 1_800_000L; // 30분

    private final ValueOperations<String, String> valueOps = mock(ValueOperations.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final RefreshTokenStore refreshTokenStore = mock(RefreshTokenStore.class);
    private final JwtTokenProvider tokenProvider = new JwtTokenProvider(
            "test-secret-key-for-motok-auth-service-spec-0123456789",
            ACCESS_MS, Duration.ofDays(14).toMillis(), ACCESS_MS);

    private final SessionRevocationStore store =
            new SessionRevocationStore(redis, refreshTokenStore, tokenProvider);

    @BeforeEach
    void stubOps() {
        given(redis.opsForValue()).willReturn(valueOps);
    }

    @Test
    @DisplayName("현재 세션의 sid를 사유와 함께 올린다 — TTL은 Access 수명 + 여유")
    void revokesCurrentSessionWithAccessLifetimeTtl() {
        given(refreshTokenStore.sessionId(USER_ID)).willReturn(SID);

        store.revokeCurrent(USER_ID, SessionRevocationStore.Reason.DISPLACED);

        verify(valueOps).set(KEY, "DISPLACED", Duration.ofMillis(ACCESS_MS).plusMinutes(1));
    }

    @Test
    @DisplayName("sid 도입 이전 세션(필드 없음)은 폐기 대상이 없다 — 아무것도 쓰지 않는다")
    void skipsLegacySessionWithoutSid() {
        given(refreshTokenStore.sessionId(USER_ID)).willReturn(null);

        store.revokeCurrent(USER_ID, SessionRevocationStore.Reason.LOGGED_OUT);

        verify(valueOps, never()).set(anyString(), anyString(), any(Duration.class));
    }

    // ── sid를 직접 받는 폐기 — Refresh 해시에서 sid를 더 읽을 수 없을 때 ────────────────
    // 재사용 탐지가 그렇다: 회전 스크립트가 유출 판정과 동시에 해시를 DEL 하므로, 그 뒤의
    // revokeCurrent는 읽을 sid가 없어 조용히 no-op이 된다.

    @Test
    @DisplayName("sid를 직접 받으면 Refresh 해시를 읽지 않고 그대로 폐기한다")
    void revokesGivenSidWithoutTouchingTheRefreshHash() {
        store.revoke(SID, SessionRevocationStore.Reason.TOKEN_REUSED);

        verify(valueOps).set(KEY, "TOKEN_REUSED", Duration.ofMillis(ACCESS_MS).plusMinutes(1));
        // 해시는 이미 지워진 뒤라 물어볼 것도 없다 — 물어보면 null이 돌아와 폐기를 건너뛴다.
        verify(refreshTokenStore, never()).sessionId(anyLong());
    }

    @Test
    @DisplayName("sid가 null이면 아무것도 쓰지 않는다 — 호출자마다 검사를 두지 않으려고 여기서 접는다")
    void skipsWhenGivenSidIsNull() {
        store.revoke(null, SessionRevocationStore.Reason.TOKEN_REUSED);

        verify(valueOps, never()).set(anyString(), anyString(), any(Duration.class));
    }

    @Test
    @DisplayName("폐기 여부 조회 — 목록에 있으면 사유, 없으면 null")
    void mapsStoredValueToReason() {
        given(valueOps.get(KEY)).willReturn("DISPLACED");
        assertThat(store.reasonOf(SID)).isEqualTo(SessionRevocationStore.Reason.DISPLACED);

        given(valueOps.get(KEY)).willReturn("LOGGED_OUT");
        assertThat(store.reasonOf(SID)).isEqualTo(SessionRevocationStore.Reason.LOGGED_OUT);

        given(valueOps.get(KEY)).willReturn("CREDENTIALS_CHANGED");
        assertThat(store.reasonOf(SID)).isEqualTo(SessionRevocationStore.Reason.CREDENTIALS_CHANGED);

        given(valueOps.get(KEY)).willReturn("WITHDRAWN");
        assertThat(store.reasonOf(SID)).isEqualTo(SessionRevocationStore.Reason.WITHDRAWN);

        given(valueOps.get(KEY)).willReturn("TOKEN_REUSED");
        assertThat(store.reasonOf(SID)).isEqualTo(SessionRevocationStore.Reason.TOKEN_REUSED);

        given(valueOps.get(KEY)).willReturn(null);
        assertThat(store.reasonOf(SID)).isNull();
    }

    // ── fail-open — 조회 실패는 "폐기 아님"이다 ─────────────────────────────
    // 호출자가 셋(REST 필터·토큰 갱신·STOMP CONNECT)이라 각자 try/catch를 들면 한 곳만 빠뜨려도
    // 그 경로만 장애 시 500을 낸다. 실제로 토큰 갱신이 그렇게 빠져 있었다 — 그래서 여기로 모았다.

    @Test
    @DisplayName("Redis 장애로 조회가 실패하면 폐기되지 않은 것으로 본다 — 장애가 곧 전면 인증 장애가 되면 안 된다")
    void failsOpenWhenRedisIsDown() {
        given(valueOps.get(KEY)).willThrow(new RedisConnectionFailureException("connection refused"));

        assertThat(store.reasonOf(SID)).isNull();
    }

    @Test
    @DisplayName("모르는 사유 문자열도 폐기 아님으로 본다 — 롤링 배포 중 새 인스턴스가 쓴 값을 옛 인스턴스가 읽는 경우")
    void failsOpenOnUnknownReason() {
        given(valueOps.get(KEY)).willReturn("SOMETHING_FROM_THE_FUTURE");

        assertThat(store.reasonOf(SID)).isNull();
    }
}
