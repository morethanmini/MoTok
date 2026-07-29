package ssafy.a706.backend.auth.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.auth.controller.dto.IssuedTokens;
import ssafy.a706.backend.auth.email.EmailVerificationService;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.auth.oauth.OauthLinkService;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.config.StompSessionRegistry;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.service.LiveRoomService;
import ssafy.a706.backend.presence.service.PresenceService;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.withdrawal.RejoinPolicy;

import java.time.Duration;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

/**
 * 갱신 요청의 세 갈래 — 정상 회전 / 동시 요청(grace) / 재사용.
 *
 * grace에서 <b>새 Refresh 토큰을 주지 않는 것</b>이 이 기능의 핵심이다. 겹쳐 들어온 두 요청에
 * 각각 새 쿠키를 물리면 나중에 도착한 응답이 브라우저의 쿠키를 옛 값으로 되돌려, 다음 갱신에서
 * 스스로 재사용 판정을 맞는다.
 */
class AuthRefreshServiceTest {

    private static final long USER_ID = 42L;
    private static final Duration REFRESH_TTL = Duration.ofDays(14);

    private final UserRepository userRepository = mock(UserRepository.class);
    private final RefreshTokenStore refreshTokenStore = mock(RefreshTokenStore.class);
    private final JwtTokenProvider tokenProvider = new JwtTokenProvider(
            "test-secret-key-for-motok-auth-service-spec-0123456789",
            3_600_000L, REFRESH_TTL.toMillis(), 1_800_000L);

    private final AuthService service = new AuthService(
            userRepository,
            mock(PasswordEncoder.class),
            tokenProvider,
            refreshTokenStore,
            mock(EmailVerificationService.class),
            mock(OauthClientResolver.class),
            mock(OauthLinkService.class),
            mock(LiveRoomService.class),
            mock(PresenceService.class),
            mock(StompSessionRegistry.class),
            mock(RejoinPolicy.class));

    private String activeUserRefreshToken() {
        User user = User.builder()
                .email("me@motok.com")
                .passwordHash("hashed")
                .nickname("모톡러")
                .build();
        ReflectionTestUtils.setField(user, "id", USER_ID);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        return tokenProvider.createRefreshToken(USER_ID);
    }

    private void verdict(RefreshTokenStore.Verdict verdict) {
        given(refreshTokenStore.rotate(eq(USER_ID), anyString(), anyString(), any(Duration.class)))
                .willReturn(verdict);
    }

    @Test
    @DisplayName("현재 토큰이면 새 Access와 회전된 Refresh를 함께 내준다")
    void rotatesOnCurrentToken() {
        String token = activeUserRefreshToken();
        verdict(RefreshTokenStore.Verdict.ROTATED);
        given(refreshTokenStore.isPersistent(USER_ID)).willReturn(true);

        IssuedTokens issued = service.refresh(token);

        assertThat(issued.body().accessToken()).isNotBlank();
        assertThat(issued.refreshToken()).isNotBlank().isNotEqualTo(token);
        assertThat(issued.refreshTtl()).isEqualTo(REFRESH_TTL);
        assertThat(issued.persistent()).isTrue();
    }

    @Test
    @DisplayName("회전 직후 겹쳐 들어온 요청(grace)은 Access만 주고 쿠키는 건드리지 않는다")
    void graceIssuesAccessTokenWithoutRotating() {
        String token = activeUserRefreshToken();
        verdict(RefreshTokenStore.Verdict.GRACE);

        IssuedTokens issued = service.refresh(token);

        assertThat(issued.body().accessToken()).isNotBlank();
        assertThat(issued.refreshToken()).isNull(); // → 컨트롤러가 Set-Cookie를 붙이지 않는다
    }

    @Test
    @DisplayName("재사용으로 판정되면 401 — 세션 무효화는 store가 이미 했다")
    void rejectsReusedToken() {
        String token = activeUserRefreshToken();
        verdict(RefreshTokenStore.Verdict.REUSED);

        assertThatThrownBy(() -> service.refresh(token))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVALID_TOKEN);
    }

    @Test
    @DisplayName("저장된 세션이 없으면(로그아웃·만료) 401")
    void rejectsWhenNoStoredSession() {
        String token = activeUserRefreshToken();
        verdict(RefreshTokenStore.Verdict.NONE);

        assertThatThrownBy(() -> service.refresh(token))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("쿠키가 아예 없으면 Redis를 건드리지 않고 401")
    void rejectsMissingCookie() {
        assertThatThrownBy(() -> service.refresh(null))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.refresh("  "))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("Access 토큰을 갱신에 쓰려는 시도는 거절한다(type=refresh만 허용)")
    void rejectsAccessTokenAsRefresh() {
        String accessToken = tokenProvider.createAccessToken(USER_ID, "모톡러", "USER");

        assertThatThrownBy(() -> service.refresh(accessToken))
                .isInstanceOf(BusinessException.class);
    }
}
