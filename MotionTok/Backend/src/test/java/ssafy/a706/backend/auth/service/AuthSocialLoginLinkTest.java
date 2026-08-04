package ssafy.a706.backend.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.auth.controller.dto.IssuedTokens;
import ssafy.a706.backend.auth.controller.dto.SocialLoginRequest;
import ssafy.a706.backend.auth.email.EmailVerificationService;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.auth.oauth.OauthLinkService;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.auth.oauth.OauthUserInfo;
import ssafy.a706.backend.auth.oauth.client.OauthClient;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.ratelimit.LoginAttemptLimiter;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.auth.session.SessionTerminator;
import ssafy.a706.backend.auth.store.AccountBlock;
import ssafy.a706.backend.auth.store.AccountBlockStore;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.text.ProfanityFilter;
import ssafy.a706.backend.liveroom.service.LiveRoomService;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.withdrawal.RejoinPolicy;

import java.time.Duration;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

/**
 * 소셜 로그인의 기존 계정 연동 안내(linkedExistingAccount).
 *
 * <p>정책(사용자 컨펌): 같은 '인증된' 이메일의 기존 계정이 있으면 자동 연동을 유지하되,
 * <b>이번에 처음</b> 연동된 응답에만 linkedExistingAccount=true를 실어 클라이언트가
 * "기존 계정으로 로그인했어요"를 1회 안내한다. 재로그인·신규 소셜 계정 생성은 null.</p>
 */
class AuthSocialLoginLinkTest {

    private static final long USER_ID = 42L;
    private static final String PROVIDER_UID = "google-sub-1";

    private final UserRepository userRepository = mock(UserRepository.class);
    private final OauthClientResolver oauthClientResolver = mock(OauthClientResolver.class);
    private final OauthLinkService oauthLinkService = mock(OauthLinkService.class);
    private final AccountBlockStore accountBlockStore = mock(AccountBlockStore.class);
    private final JwtTokenProvider tokenProvider = new JwtTokenProvider(
            "test-secret-key-for-motok-auth-service-spec-0123456789",
            3_600_000L, Duration.ofDays(14).toMillis(), 1_800_000L);

    private final AuthService service = new AuthService(
            userRepository,
            mock(PasswordEncoder.class),
            tokenProvider,
            mock(RefreshTokenStore.class),
            accountBlockStore,
            mock(EmailVerificationService.class),
            oauthClientResolver,
            oauthLinkService,
            mock(LiveRoomService.class),
            mock(SessionTerminator.class),
            mock(SessionRevocationStore.class),
            mock(LoginAttemptLimiter.class),
            mock(RejoinPolicy.class),
            mock(ProfanityFilter.class));

    @BeforeEach
    void setUp() {
        given(accountBlockStore.blockOf(anyLong())).willReturn(AccountBlock.NONE);

        OauthClient client = mock(OauthClient.class);
        given(oauthClientResolver.resolve(OauthProvider.GOOGLE)).willReturn(client);
        given(client.fetch(any(), any())).willReturn(new OauthUserInfo(
                OauthProvider.GOOGLE, PROVIDER_UID, "me@motok.com", true, "구글이름"));

        User user = User.builder()
                .email("me@motok.com")
                .passwordHash("hashed")
                .nickname("모톡러")
                .build();
        ReflectionTestUtils.setField(user, "id", USER_ID);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
    }

    private IssuedTokens socialLogin() {
        return service.socialLogin("google", new SocialLoginRequest("code", null), null);
    }

    @Test
    @DisplayName("같은 인증 이메일의 기존 계정에 처음 연동되면 linkedExistingAccount=true")
    void firstLinkToExistingAccount_flagsResponse() {
        given(oauthLinkService.findLinkedUserId(OauthProvider.GOOGLE, PROVIDER_UID))
                .willReturn(Optional.empty());
        given(oauthLinkService.createAndLink(any(), any()))
                .willReturn(new OauthLinkService.LinkResult(USER_ID, true));

        assertThat(socialLogin().body().linkedExistingAccount()).isTrue();
    }

    @Test
    @DisplayName("이미 연동된 계정의 재로그인은 안내하지 않는다(null)")
    void relogin_doesNotFlag() {
        given(oauthLinkService.findLinkedUserId(OauthProvider.GOOGLE, PROVIDER_UID))
                .willReturn(Optional.of(USER_ID));

        assertThat(socialLogin().body().linkedExistingAccount()).isNull();
    }

    @Test
    @DisplayName("신규 소셜 전용 계정 생성도 안내하지 않는다(null)")
    void newSocialAccount_doesNotFlag() {
        given(oauthLinkService.findLinkedUserId(OauthProvider.GOOGLE, PROVIDER_UID))
                .willReturn(Optional.empty());
        given(oauthLinkService.createAndLink(any(), any()))
                .willReturn(new OauthLinkService.LinkResult(USER_ID, false));

        assertThat(socialLogin().body().linkedExistingAccount()).isNull();
    }
}
