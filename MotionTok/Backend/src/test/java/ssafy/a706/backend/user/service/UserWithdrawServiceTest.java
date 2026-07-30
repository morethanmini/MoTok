package ssafy.a706.backend.user.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.auth.oauth.OauthUserInfo;
import ssafy.a706.backend.auth.oauth.client.OauthClient;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.oauth.entity.OauthAccount;
import ssafy.a706.backend.auth.oauth.repository.OauthAccountRepository;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.shop.repository.PointHistoryRepository;
import ssafy.a706.backend.storage.StorageService;
import ssafy.a706.backend.user.controller.dto.WithdrawRequest;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.enums.UserStatus;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.withdrawal.RejoinPolicy;
import ssafy.a706.backend.user.withdrawal.WithdrawnIdentifierType;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 탈퇴 본인 확인과 재가입 제한 기록 (-111).
 * 소셜 전용 계정에 비밀번호를 요구하면 탈퇴 자체가 불가능해지므로, 소셜 재인증 경로가 반드시 열려 있어야 한다.
 */
class UserWithdrawServiceTest {

    private static final long USER_ID = 42L;

    private final UserRepository userRepository = mock(UserRepository.class);
    private final PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
    private final RefreshTokenStore refreshTokenStore = mock(RefreshTokenStore.class);
    private final SessionRevocationStore sessionRevocationStore = mock(SessionRevocationStore.class);
    private final OauthAccountRepository oauthAccountRepository = mock(OauthAccountRepository.class);
    private final OauthClientResolver oauthClientResolver = mock(OauthClientResolver.class);
    private final RejoinPolicy rejoinPolicy = mock(RejoinPolicy.class);
    private final StorageService storageService = mock(StorageService.class);

    private final UserService service = new UserService(userRepository,
            mock(PointHistoryRepository.class), passwordEncoder,
            refreshTokenStore, sessionRevocationStore,
            oauthAccountRepository, oauthClientResolver, rejoinPolicy, storageService,
            mock(ssafy.a706.backend.conntime.service.ConnectTimeService.class));

    private User localUser() {
        User user = User.builder()
                .email("me@motok.com")
                .passwordHash("hashed")
                .nickname("모톡러")
                .build();
        ReflectionTestUtils.setField(user, "id", USER_ID);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        return user;
    }

    private User socialOnlyUser() {
        User user = User.builder()
                .email("social@motok.com")
                .passwordHash(null)
                .nickname("소셜러")
                .build();
        ReflectionTestUtils.setField(user, "id", USER_ID);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        return user;
    }

    @Test
    @DisplayName("자체 가입 계정은 비밀번호가 맞아야 탈퇴된다")
    void withdrawsWithPassword() {
        User user = localUser();
        given(passwordEncoder.matches("pw", "hashed")).willReturn(true);
        given(oauthAccountRepository.findAllByUser(user)).willReturn(List.of());

        service.withdraw(USER_ID, new WithdrawRequest("pw", null, null, null));

        assertThat(user.getStatus()).isEqualTo(UserStatus.DELETED);
        verify(rejoinPolicy).record("me@motok.com", WithdrawnIdentifierType.EMAIL);
        verify(refreshTokenStore).delete(USER_ID);
    }

    // ── 탈퇴 시 세션 폐기(v0.2.26) — 탈퇴한 계정의 액세스 토큰이 만료까지 살아 있으면 안 된다 ──────

    @Test
    @DisplayName("탈퇴하면 액세스 토큰까지 폐기한다 — Refresh를 지우기 전에 폐기해야 sid를 읽을 수 있다")
    void revokesSessionBeforeDeletingRefresh() {
        User user = localUser();
        given(passwordEncoder.matches("pw", "hashed")).willReturn(true);
        given(oauthAccountRepository.findAllByUser(user)).willReturn(List.of());

        service.withdraw(USER_ID, new WithdrawRequest("pw", null, null, null));

        // 순서가 곧 동작이다 — delete가 먼저 돌면 sid가 사라져 폐기가 조용히 no-op이 된다.
        InOrder order = inOrder(sessionRevocationStore, refreshTokenStore);
        order.verify(sessionRevocationStore)
                .revokeCurrent(USER_ID, SessionRevocationStore.Reason.WITHDRAWN);
        order.verify(refreshTokenStore).delete(USER_ID);
    }

    @Test
    @DisplayName("본인 확인에 실패하면 세션을 폐기하지 않는다 — 남의 세션을 끊는 수단이 되면 안 된다")
    void keepsSessionWhenOwnershipCheckFails() {
        localUser();
        given(passwordEncoder.matches("wrong", "hashed")).willReturn(false);

        assertThatThrownBy(() -> service.withdraw(USER_ID, new WithdrawRequest("wrong", null, null, null)))
                .isInstanceOf(BusinessException.class);

        verify(sessionRevocationStore, never()).revokeCurrent(any(), any());
    }

    @Test
    @DisplayName("비밀번호가 틀리면 탈퇴되지 않는다")
    void rejectsWrongPassword() {
        User user = localUser();
        given(passwordEncoder.matches("wrong", "hashed")).willReturn(false);

        assertThatThrownBy(() -> service.withdraw(USER_ID, new WithdrawRequest("wrong", null, null, null)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVALID_CREDENTIALS);

        assertThat(user.getStatus()).isEqualTo(UserStatus.ACTIVE);
        verify(rejoinPolicy, never()).record(any(), any());
    }

    @Test
    @DisplayName("본인 확인 값이 없으면 자체 가입 계정에는 비밀번호를 요구한다")
    void requiresPasswordWhenProofMissing() {
        localUser();

        assertThatThrownBy(() -> service.withdraw(USER_ID, null))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.WITHDRAW_REAUTH_REQUIRED);
    }

    @Test
    @DisplayName("소셜 전용 계정에는 비밀번호 대신 소셜 재인증을 요구한다")
    void requiresSocialReauthForSocialOnly() {
        socialOnlyUser();

        assertThatThrownBy(() -> service.withdraw(USER_ID, new WithdrawRequest("anything", null, null, null)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.WITHDRAW_SOCIAL_REAUTH_REQUIRED);
    }

    @Test
    @DisplayName("소셜 재인증이 이 계정의 연동과 일치하면 탈퇴되고, 소셜 식별자도 재가입 제한에 기록된다")
    void withdrawsWithSocialReauth() {
        User user = socialOnlyUser();
        OauthAccount linked = OauthAccount.of(user, OauthProvider.GOOGLE, "uid-1");
        OauthClient client = mock(OauthClient.class);

        given(oauthClientResolver.resolve(OauthProvider.GOOGLE)).willReturn(client);
        given(client.fetch("code", "https://motok/auth"))
                .willReturn(new OauthUserInfo(OauthProvider.GOOGLE, "uid-1", "social@motok.com", true, null));
        given(oauthAccountRepository.findByProviderAndProviderUid(OauthProvider.GOOGLE, "uid-1"))
                .willReturn(Optional.of(linked));
        given(oauthAccountRepository.findAllByUser(user)).willReturn(List.of(linked));

        service.withdraw(USER_ID, new WithdrawRequest(null, "google", "code", "https://motok/auth"));

        assertThat(user.getStatus()).isEqualTo(UserStatus.DELETED);
        verify(rejoinPolicy).record("social@motok.com", WithdrawnIdentifierType.EMAIL);
        verify(rejoinPolicy).record(eq("GOOGLE:uid-1"), eq(WithdrawnIdentifierType.SOCIAL));
    }

    @Test
    @DisplayName("남의 소셜 계정으로 인증하면 탈퇴되지 않는다")
    void rejectsSomeoneElsesSocialAccount() {
        User user = socialOnlyUser();
        User other = User.builder().nickname("남").build();
        ReflectionTestUtils.setField(other, "id", 99L);
        OauthClient client = mock(OauthClient.class);

        given(oauthClientResolver.resolve(OauthProvider.GOOGLE)).willReturn(client);
        given(client.fetch("code", null))
                .willReturn(new OauthUserInfo(OauthProvider.GOOGLE, "uid-other", null, false, null));
        given(oauthAccountRepository.findByProviderAndProviderUid(OauthProvider.GOOGLE, "uid-other"))
                .willReturn(Optional.of(OauthAccount.of(other, OauthProvider.GOOGLE, "uid-other")));

        assertThatThrownBy(() ->
                service.withdraw(USER_ID, new WithdrawRequest(null, "google", "code", null)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVALID_CREDENTIALS);

        assertThat(user.getStatus()).isEqualTo(UserStatus.ACTIVE);
    }
}
