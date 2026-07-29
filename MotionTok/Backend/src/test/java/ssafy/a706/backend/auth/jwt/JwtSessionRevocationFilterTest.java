package ssafy.a706.backend.auth.jwt;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.auth.store.AccountBlock;
import ssafy.a706.backend.auth.store.AccountBlockStore;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 폐기된 세션(sid)의 액세스 토큰은 서명이 유효해도 인증되지 않는다(v0.2.25) —
 * 밀려난 옛 기기가 방 생성·SFU 토큰 발급을 이어가는 구멍을 막는 지점.
 * 단, 폐기 확인이 곧 가용성의 급소가 되면 안 되므로 Redis 장애는 fail-open이다.
 */
class JwtSessionRevocationFilterTest {

    private static final String SID = "sid-42-current";

    private final JwtTokenProvider provider = new JwtTokenProvider(
            "test-secret-key-for-motok-auth-service-spec-0123456789",
            3_600_000L, 1_209_600_000L, 1_800_000L);
    private final SessionRevocationStore revocationStore = mock(SessionRevocationStore.class);
    private final AccountBlockStore accountBlockStore = mock(AccountBlockStore.class);
    private final JwtAuthenticationFilter filter = new JwtAuthenticationFilter(
            provider, revocationStore, accountBlockStore, new ObjectMapper());

    /** 제재는 이 테스트의 관심사가 아니다 — 열거형 반환은 mock 기본값이 null이라 명시한다. */
    @BeforeEach
    void notBlocked() {
        given(accountBlockStore.blockOf(anyLong())).willReturn(AccountBlock.NONE);
    }

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("밀려난 세션의 토큰은 인증하지 않고, 사유를 entry point에 남긴다")
    void rejectsDisplacedSessionAndMarksRequest() throws Exception {
        given(revocationStore.reasonOf(SID)).willReturn(SessionRevocationStore.Reason.DISPLACED);

        MockHttpServletRequest request = requestWith(provider.createAccessToken(42L, "모톡러", "USER", SID));
        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        assertThat(JwtAuthenticationFilter.wasDisplaced(request)).isTrue();
    }

    @Test
    @DisplayName("로그아웃으로 폐기된 토큰도 인증하지 않는다 — 단, 밀려남 표시는 없다(일반 401)")
    void rejectsLoggedOutSessionWithoutDisplacedMark() throws Exception {
        given(revocationStore.reasonOf(SID)).willReturn(SessionRevocationStore.Reason.LOGGED_OUT);

        MockHttpServletRequest request = requestWith(provider.createAccessToken(42L, "모톡러", "USER", SID));
        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        assertThat(JwtAuthenticationFilter.wasDisplaced(request)).isFalse();
    }

    @Test
    @DisplayName("폐기 목록에 없는 토큰은 그대로 인증된다")
    void authenticatesUnrevokedToken() throws Exception {
        given(revocationStore.reasonOf(SID)).willReturn(null);

        filter.doFilter(requestWith(provider.createAccessToken(42L, "모톡러", "USER", SID)),
                new MockHttpServletResponse(), new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
    }

    @Test
    @DisplayName("Redis 장애 시 서명 검증만으로 통과시킨다(fail-open) — 폐기 확인이 전면 장애가 되면 안 된다")
    void failsOpenOnRedisFailure() throws Exception {
        given(revocationStore.reasonOf(SID))
                .willThrow(new RedisConnectionFailureException("connection refused"));

        filter.doFilter(requestWith(provider.createAccessToken(42L, "모톡러", "USER", SID)),
                new MockHttpServletResponse(), new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
    }

    @Test
    @DisplayName("게스트 토큰은 sid가 없어 폐기 목록을 조회하지 않는다")
    void skipsRevocationCheckForGuestToken() throws Exception {
        filter.doFilter(requestWith(provider.createGuestToken("guest-abcd1234", "게스트1234")),
                new MockHttpServletResponse(), new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
        verify(revocationStore, never()).reasonOf(anyString());
    }

    private MockHttpServletRequest requestWith(String token) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer " + token);
        return request;
    }
}
