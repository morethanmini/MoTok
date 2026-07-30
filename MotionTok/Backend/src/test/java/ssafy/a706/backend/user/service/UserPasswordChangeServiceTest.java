package ssafy.a706.backend.user.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.oauth.repository.OauthAccountRepository;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.conntime.service.ConnectTimeService;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.shop.repository.PointHistoryRepository;
import ssafy.a706.backend.storage.StorageService;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.withdrawal.RejoinPolicy;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 비밀번호 변경은 그 계정의 세션을 즉시 끝내야 한다.
 *
 * <p>깨지면 나는 사고 — 비밀번호를 바꿔도 옛 비밀번호로 열린 액세스 토큰이 만료(30분)까지 살아,
 * 자격증명이 샌 뒤 비밀번호를 바꾸는 그 순간에도 상대가 30분을 더 쓸 수 있다.
 * 반대로 실패 경로에서 폐기가 일어나면 아무 비밀번호나 던져 남의 세션을 계속 끊을 수 있다.</p>
 */
class UserPasswordChangeServiceTest {

    private static final long USER_ID = 42L;

    private final UserRepository userRepository = mock(UserRepository.class);
    private final PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
    private final RefreshTokenStore refreshTokenStore = mock(RefreshTokenStore.class);
    private final SessionRevocationStore sessionRevocationStore = mock(SessionRevocationStore.class);

    private final UserService service = new UserService(userRepository,
            mock(PointHistoryRepository.class), passwordEncoder,
            refreshTokenStore, sessionRevocationStore,
            mock(OauthAccountRepository.class), mock(OauthClientResolver.class),
            mock(RejoinPolicy.class), mock(StorageService.class), mock(ConnectTimeService.class));

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

    @Test
    @DisplayName("비밀번호를 바꾸면 Refresh를 지우기 전에 현재 세션을 폐기한다 — 순서가 뒤집히면 조용히 무효가 된다")
    void revokesSessionBeforeDeletingRefresh() {
        localUser();
        given(passwordEncoder.matches("old-pw", "hashed")).willReturn(true);

        service.changePassword(USER_ID, "old-pw", "Motok!2345abcd");

        // delete가 먼저 돌면 sid를 담고 있던 Refresh 해시가 사라져 revokeCurrent가 아무 일도 하지 않는다.
        // 그래서 "불렸는가"가 아니라 "언제 불렸는가"를 못박는다.
        // 사유도 리터럴로 고정한다 — DISPLACED로 잘못 넘기면 프론트가 "다른 곳에서 로그인" 안내를 띄운다.
        InOrder order = inOrder(sessionRevocationStore, refreshTokenStore);
        order.verify(sessionRevocationStore)
                .revokeCurrent(USER_ID, SessionRevocationStore.Reason.CREDENTIALS_CHANGED);
        order.verify(refreshTokenStore).delete(USER_ID);
    }

    @Test
    @DisplayName("현재 비밀번호가 틀리면 세션을 건드리지 않는다 — 남의 세션을 끊는 수단이 되면 안 된다")
    void keepsSessionWhenCurrentPasswordIsWrong() {
        localUser();
        given(passwordEncoder.matches(anyString(), anyString())).willReturn(false);

        assertThatThrownBy(() -> service.changePassword(USER_ID, "wrong-pw", "Motok!2345abcd"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVALID_CREDENTIALS);

        verify(sessionRevocationStore, never()).revokeCurrent(anyLong(), any());
        verify(refreshTokenStore, never()).delete(anyLong());
    }

    @Test
    @DisplayName("비밀번호가 없는 소셜 전용 계정도 세션을 건드리지 않고 거절된다")
    void keepsSessionForSocialOnlyAccount() {
        User user = User.builder().email("social@motok.com").passwordHash(null).nickname("소셜러").build();
        ReflectionTestUtils.setField(user, "id", USER_ID);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        assertThatThrownBy(() -> service.changePassword(USER_ID, "anything", "Motok!2345abcd"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVALID_CREDENTIALS);

        verify(sessionRevocationStore, never()).revokeCurrent(anyLong(), any());
    }
}
