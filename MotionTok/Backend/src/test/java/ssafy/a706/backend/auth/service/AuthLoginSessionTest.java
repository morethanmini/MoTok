package ssafy.a706.backend.auth.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.BeforeEach;
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
import ssafy.a706.backend.auth.session.SessionTerminator;
import ssafy.a706.backend.auth.store.AccountBlock;
import ssafy.a706.backend.auth.store.AccountBlockStore;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.text.ProfanityFilter;
import ssafy.a706.backend.liveroom.service.LiveRoomService;
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
    private final SessionTerminator sessionTerminator = mock(SessionTerminator.class);
    private final LoginAttemptLimiter loginAttemptLimiter = mock(LoginAttemptLimiter.class);
    private final JwtTokenProvider tokenProvider = new JwtTokenProvider(
            "test-secret-key-for-motok-auth-service-spec-0123456789",
            3_600_000L, Duration.ofDays(14).toMillis(), 1_800_000L);

    /**
     * 제재 조회는 이 테스트의 관심사가 아니다 — "막히지 않음"으로 고정한다.
     * 열거형 반환은 mock 기본값이 null이라 명시해야 한다(null이면 로그인 경로가 NPE로 죽는다).
     */
    private final AccountBlockStore accountBlockStore = mock(AccountBlockStore.class);

    private final AuthService service = new AuthService(
            userRepository,
            passwordEncoder,
            tokenProvider,
            refreshTokenStore,

            accountBlockStore,
            mock(EmailVerificationService.class),
            mock(OauthClientResolver.class),
            mock(OauthLinkService.class),
            mock(LiveRoomService.class),
            sessionTerminator,
            mock(SessionRevocationStore.class),
            loginAttemptLimiter,
            mock(RejoinPolicy.class),
            mock(ProfanityFilter.class));

    @BeforeEach
    void notBlocked() {
        given(accountBlockStore.blockOf(anyLong())).willReturn(AccountBlock.NONE);
    }

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

        service.login(new LoginRequest(EMAIL, PASSWORD, true), null);

        verify(sessionTerminator).displacePrevious(USER_ID, null);
    }

    @Test
    @DisplayName("로그인 요청에 실려 온 옛 Refresh 쿠키의 sid를 밀어내기 판단에 넘긴다")
    void forwardsPresentedSessionIdFromStaleCookie() {
        activeUser();
        given(passwordEncoder.matches(PASSWORD, "hashed")).willReturn(true);
        // 로그아웃 없이 탭을 닫았다 다시 로그인한 브라우저가 보내는 쿠키.
        String staleCookie = tokenProvider.createRefreshToken(USER_ID, "sid-still-in-redis");

        service.login(new LoginRequest(EMAIL, PASSWORD, true), staleCookie);

        // 이 sid가 서버에 남아 있는 이전 세션과 같으면 밀어내기가 아니라 자기 세션의 교체다.
        verify(sessionTerminator).displacePrevious(USER_ID, "sid-still-in-redis");
    }

    @Test
    @DisplayName("망가진 Refresh 쿠키는 없는 것으로 본다 — 위조로 밀어내기를 건너뛸 수 없다")
    void ignoresUnverifiableCookie() {
        activeUser();
        given(passwordEncoder.matches(PASSWORD, "hashed")).willReturn(true);

        service.login(new LoginRequest(EMAIL, PASSWORD, true), "not-a-jwt");

        // null이면 평소대로 밀어낸다 — 판단이 흐려질 때 안전한 쪽으로 접힌다.
        verify(sessionTerminator).displacePrevious(USER_ID, null);
    }

    @Test
    @DisplayName("비밀번호가 틀리면 밀어내지 않는다 — 남의 세션을 끊는 수단이 되면 안 된다")
    void keepsSessionWhenCredentialsAreWrong() {
        activeUser();
        given(passwordEncoder.matches(anyString(), anyString())).willReturn(false);

        assertThatThrownBy(() -> service.login(new LoginRequest(EMAIL, "wrong-password-1234", true), null))
                .isInstanceOf(BusinessException.class);

        verify(sessionTerminator, never()).displacePrevious(anyLong(), any());
        verify(refreshTokenStore, never()).save(anyLong(), anyString(), any(Duration.class), anyBoolean(), anyString());
    }

    @Test
    @DisplayName("실패는 백오프 카운터에 쌓이고, 성공하면 초기화된다")
    void feedsLoginBackoff() {
        activeUser();
        given(passwordEncoder.matches(anyString(), anyString())).willReturn(false);
        assertThatThrownBy(() -> service.login(new LoginRequest(EMAIL, "wrong-password-1234", true), null))
                .isInstanceOf(BusinessException.class);
        verify(loginAttemptLimiter).recordFailure(EMAIL);

        given(passwordEncoder.matches(PASSWORD, "hashed")).willReturn(true);
        service.login(new LoginRequest(EMAIL, PASSWORD, true), null);
        verify(loginAttemptLimiter).reset(EMAIL);
    }

    @Test
    @DisplayName("차단 중이면 비밀번호를 대조하지도 않는다")
    void skipsPasswordCheckWhileBlocked() {
        activeUser();
        willThrow(new BusinessException(ErrorCode.LOGIN_ATTEMPTS_EXCEEDED))
                .given(loginAttemptLimiter).ensureNotBlocked(EMAIL);

        assertThatThrownBy(() -> service.login(new LoginRequest(EMAIL, PASSWORD, true), null))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.LOGIN_ATTEMPTS_EXCEEDED);

        verify(passwordEncoder, never()).matches(anyString(), anyString());
    }

    @Test
    @DisplayName("rememberMe가 Refresh 토큰의 저장 수명 플래그로 넘어간다")
    void passesRememberMeToStore() {
        activeUser();
        given(passwordEncoder.matches(PASSWORD, "hashed")).willReturn(true);

        assertThat(service.login(new LoginRequest(EMAIL, PASSWORD, false), null).persistent()).isFalse();
        verify(refreshTokenStore).save(eq(USER_ID), anyString(), any(Duration.class), eq(false), anyString());

        assertThat(service.login(new LoginRequest(EMAIL, PASSWORD, true), null).persistent()).isTrue();
        verify(refreshTokenStore).save(eq(USER_ID), anyString(), any(Duration.class), eq(true), anyString());
    }
}
