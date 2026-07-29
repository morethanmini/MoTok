package ssafy.a706.backend.auth.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.auth.controller.dto.LoginRequest;
import ssafy.a706.backend.auth.email.EmailVerificationService;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.auth.oauth.OauthLinkService;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.ratelimit.LoginAttemptLimiter;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.auth.session.SingleSessionPolicy;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.config.StompSessionRegistry;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.text.ProfanityFilter;
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
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 단일 세션 — 새 로그인은 기존 세션을 밀어낸다.
 *
 * <p>밀어내기가 <b>인증에 성공한 뒤에만</b> 일어나는 것이 핵심이다. 비밀번호를 틀린 요청에도
 * 밀려난다면, 남의 아이디에 아무 비밀번호나 던지는 것만으로 그 사람을 계속 튕겨낼 수 있다.</p>
 */
class AuthLoginSessionTest {

    private static final long USER_ID = 42L;
    private static final String EMAIL = "me@motok.com";
    private static final String PASSWORD = "Motok!2345abcd";

    private final UserRepository userRepository = mock(UserRepository.class);
    private final PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
    private final RefreshTokenStore refreshTokenStore = mock(RefreshTokenStore.class);
    private final SingleSessionPolicy singleSessionPolicy = mock(SingleSessionPolicy.class);
    private final LoginAttemptLimiter loginAttemptLimiter = mock(LoginAttemptLimiter.class);
    private final JwtTokenProvider tokenProvider = new JwtTokenProvider(
            "test-secret-key-for-motok-auth-service-spec-0123456789",
            3_600_000L, Duration.ofDays(14).toMillis(), 1_800_000L);

    private final AuthService service = new AuthService(
            userRepository,
            passwordEncoder,
            tokenProvider,
            refreshTokenStore,
            mock(EmailVerificationService.class),
            mock(OauthClientResolver.class),
            mock(OauthLinkService.class),
            mock(LiveRoomService.class),
            mock(PresenceService.class),
            mock(StompSessionRegistry.class),
            singleSessionPolicy,
            mock(SessionRevocationStore.class),
            loginAttemptLimiter,
            mock(RejoinPolicy.class),
            mock(ProfanityFilter.class));

    private void activeUser() {
        User user = User.builder()
                .email(EMAIL)
                .passwordHash("hashed")
                .nickname("모톡러")
                .build();
        ReflectionTestUtils.setField(user, "id", USER_ID);
        given(userRepository.findByEmail(EMAIL)).willReturn(Optional.of(user));
    }

    @Test
    @DisplayName("로그인에 성공하면 기존 세션을 밀어낸다")
    void displacesPreviousSessionOnLogin() {
        activeUser();
        given(passwordEncoder.matches(PASSWORD, "hashed")).willReturn(true);

        service.login(new LoginRequest(EMAIL, PASSWORD, true));

        verify(singleSessionPolicy).displacePrevious(USER_ID);
    }

    @Test
    @DisplayName("비밀번호가 틀리면 밀어내지 않는다 — 남의 세션을 끊는 수단이 되면 안 된다")
    void keepsSessionWhenCredentialsAreWrong() {
        activeUser();
        given(passwordEncoder.matches(anyString(), anyString())).willReturn(false);

        assertThatThrownBy(() -> service.login(new LoginRequest(EMAIL, "wrong-password-1234", true)))
                .isInstanceOf(BusinessException.class);

        verify(singleSessionPolicy, never()).displacePrevious(anyLong());
        verify(refreshTokenStore, never()).save(anyLong(), anyString(), any(Duration.class), anyBoolean(), anyString());
    }

    @Test
    @DisplayName("실패는 백오프 카운터에 쌓이고, 성공하면 초기화된다")
    void feedsLoginBackoff() {
        activeUser();
        given(passwordEncoder.matches(anyString(), anyString())).willReturn(false);
        assertThatThrownBy(() -> service.login(new LoginRequest(EMAIL, "wrong-password-1234", true)))
                .isInstanceOf(BusinessException.class);
        verify(loginAttemptLimiter).recordFailure(EMAIL);

        given(passwordEncoder.matches(PASSWORD, "hashed")).willReturn(true);
        service.login(new LoginRequest(EMAIL, PASSWORD, true));
        verify(loginAttemptLimiter).reset(EMAIL);
    }

    @Test
    @DisplayName("차단 중이면 비밀번호를 대조하지도 않는다")
    void skipsPasswordCheckWhileBlocked() {
        activeUser();
        willThrow(new BusinessException(ErrorCode.LOGIN_ATTEMPTS_EXCEEDED))
                .given(loginAttemptLimiter).ensureNotBlocked(EMAIL);

        assertThatThrownBy(() -> service.login(new LoginRequest(EMAIL, PASSWORD, true)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.LOGIN_ATTEMPTS_EXCEEDED);

        verify(passwordEncoder, never()).matches(anyString(), anyString());
    }

    @Test
    @DisplayName("rememberMe가 Refresh 토큰의 저장 수명 플래그로 넘어간다")
    void passesRememberMeToStore() {
        activeUser();
        given(passwordEncoder.matches(PASSWORD, "hashed")).willReturn(true);

        assertThat(service.login(new LoginRequest(EMAIL, PASSWORD, false)).persistent()).isFalse();
        verify(refreshTokenStore).save(eq(USER_ID), anyString(), any(Duration.class), eq(false), anyString());

        assertThat(service.login(new LoginRequest(EMAIL, PASSWORD, true)).persistent()).isTrue();
        verify(refreshTokenStore).save(eq(USER_ID), anyString(), any(Duration.class), eq(true), anyString());
    }
}
