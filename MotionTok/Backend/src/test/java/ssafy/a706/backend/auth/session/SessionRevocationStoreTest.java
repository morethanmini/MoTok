package ssafy.a706.backend.auth.session;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.auth.store.RefreshTokenStore;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
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

    @Test
    @DisplayName("폐기 여부 조회 — 목록에 있으면 사유, 없으면 null")
    void mapsStoredValueToReason() {
        given(valueOps.get(KEY)).willReturn("DISPLACED");
        assertThat(store.reasonOf(SID)).isEqualTo(SessionRevocationStore.Reason.DISPLACED);

        given(valueOps.get(KEY)).willReturn("LOGGED_OUT");
        assertThat(store.reasonOf(SID)).isEqualTo(SessionRevocationStore.Reason.LOGGED_OUT);

        given(valueOps.get(KEY)).willReturn(null);
        assertThat(store.reasonOf(SID)).isNull();
    }
}
