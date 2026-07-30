package ssafy.a706.backend.auth.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import ssafy.a706.backend.auth.email.EmailVerificationService;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.auth.oauth.OauthLinkService;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.ratelimit.LoginAttemptLimiter;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.auth.session.SessionTerminator;
import ssafy.a706.backend.auth.store.AccountBlockStore;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.text.ProfanityFilter;
import ssafy.a706.backend.liveroom.service.LiveRoomService;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.withdrawal.RejoinPolicy;

import java.time.Duration;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * 로그아웃은 정리를 <b>남에게 미루지 않는다</b>.
 *
 * <p>정리 순서 자체는 {@code SessionTerminatorTest}가 못박는다. 여기서 지키는 것은 그보다 앞의
 * 두 가지다 — 정리를 <b>부르기는 하는가</b>, 그리고 <b>어떤 사유로</b> 부르는가.
 * 사유가 DISPLACED로 새면 로그아웃한 사용자에게 "다른 곳에서 로그인" 안내가 뜨고,
 * 아예 부르지 않으면 이미 열린 웹소켓이 살아남아 하트비트로 접속 상태를 되살린다.</p>
 */
class AuthLogoutServiceTest {

    private static final long USER_ID = 42L;

    private final SessionTerminator sessionTerminator = mock(SessionTerminator.class);
    private final RefreshTokenStore refreshTokenStore = mock(RefreshTokenStore.class);

    private final AuthService service = new AuthService(
            mock(UserRepository.class),
            mock(PasswordEncoder.class),
            new JwtTokenProvider("test-secret-key-for-motok-auth-service-spec-0123456789",
                    3_600_000L, Duration.ofDays(14).toMillis(), 1_800_000L),
            refreshTokenStore,
            mock(AccountBlockStore.class),
            mock(EmailVerificationService.class),
            mock(OauthClientResolver.class),
            mock(OauthLinkService.class),
            mock(LiveRoomService.class),
            sessionTerminator,
            mock(SessionRevocationStore.class),
            mock(LoginAttemptLimiter.class),
            mock(RejoinPolicy.class),
            mock(ProfanityFilter.class));

    @Test
    @DisplayName("로그아웃하면 LOGGED_OUT 사유로 세션 정리를 한 번 부른다")
    void terminatesTheSessionAsLoggedOut() {
        service.logout(USER_ID);

        verify(sessionTerminator).terminate(USER_ID, SessionRevocationStore.Reason.LOGGED_OUT);
    }

    @Test
    @DisplayName("정리는 전부 협력자에게 맡긴다 — 여기서 Refresh를 또 지우면 순서 계약이 두 곳으로 갈린다")
    void leavesEveryCleanupStepToTheTerminator() {
        service.logout(USER_ID);

        verifyNoMoreInteractions(refreshTokenStore);
    }
}
