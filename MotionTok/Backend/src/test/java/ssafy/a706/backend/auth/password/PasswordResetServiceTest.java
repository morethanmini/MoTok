package ssafy.a706.backend.auth.password;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.time.Duration;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 비밀번호 재설정은 계정을 되찾는 경로다 — 끝나는 순간 그 계정의 세션도 끝나야 한다.
 *
 * <p>이 엔드포인트는 인증 없이 열려 있어(메일 링크) 요청자와 폐기 대상이 다른 사람이다.
 * 깨지면 나는 사고 — 계정을 빼앗은 쪽의 액세스 토큰이 만료(30분)까지 살아, 주인이 비밀번호를
 * 되찾은 뒤에도 그 창 동안 상대가 계정을 계속 쓴다. 재설정의 목적 자체가 무력해진다.</p>
 */
class PasswordResetServiceTest {

    private static final long USER_ID = 42L;
    private static final String TOKEN = "reset-token-1";

    private final UserRepository userRepository = mock(UserRepository.class);
    private final PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
    private final PwResetTokenStore tokenStore = mock(PwResetTokenStore.class);
    private final RefreshTokenStore refreshTokenStore = mock(RefreshTokenStore.class);
    private final SessionRevocationStore sessionRevocationStore = mock(SessionRevocationStore.class);

    // props는 record(final)라 mock 대신 실제 인스턴스를 넘긴다 — 재설정 확정 경로에서는 쓰이지 않는다.
    private final PasswordResetService service = new PasswordResetService(
            userRepository, passwordEncoder, tokenStore,
            mock(PasswordResetMailSender.class), refreshTokenStore, sessionRevocationStore,
            new PasswordResetProperties(Duration.ofMinutes(30), "https://motok/auth/reset-password"));

    private void userExists() {
        User user = User.builder()
                .email("me@motok.com")
                .passwordHash("hashed")
                .nickname("모톡러")
                .build();
        ReflectionTestUtils.setField(user, "id", USER_ID);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
    }

    @Test
    @DisplayName("재설정이 끝나면 Refresh를 지우기 전에 그 계정의 세션을 폐기한다")
    void revokesSessionBeforeDeletingRefresh() {
        given(tokenStore.consume(TOKEN)).willReturn(USER_ID);
        userExists();

        service.resetPassword(TOKEN, "Motok!2345abcd");

        // delete가 먼저 돌면 sid가 사라져 폐기가 조용히 no-op이 된다 — 순서가 곧 동작이다.
        InOrder order = inOrder(sessionRevocationStore, refreshTokenStore);
        order.verify(sessionRevocationStore)
                .revokeCurrent(USER_ID, SessionRevocationStore.Reason.CREDENTIALS_CHANGED);
        order.verify(refreshTokenStore).delete(USER_ID);
    }

    @Test
    @DisplayName("토큰이 유효하지 않으면 아무 세션도 폐기하지 않는다 — 남의 세션을 끊는 수단이 되면 안 된다")
    void keepsSessionWhenTokenIsInvalid() {
        given(tokenStore.consume(TOKEN)).willReturn(null);

        assertThatThrownBy(() -> service.resetPassword(TOKEN, "Motok!2345abcd"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.PASSWORD_RESET_TOKEN_INVALID);

        verify(sessionRevocationStore, never()).revokeCurrent(anyLong(), any());
        verify(refreshTokenStore, never()).delete(anyLong());
    }

    @Test
    @DisplayName("토큰이 가리키는 계정이 없으면 폐기하지 않는다 — userId가 null인 채로 불려 NPE가 나도 안 된다")
    void keepsSessionWhenUserIsGone() {
        given(tokenStore.consume(TOKEN)).willReturn(USER_ID);
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> service.resetPassword(TOKEN, "Motok!2345abcd"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.PASSWORD_RESET_TOKEN_INVALID);

        verify(sessionRevocationStore, never()).revokeCurrent(anyLong(), any());
    }
}
