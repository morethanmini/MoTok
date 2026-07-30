package ssafy.a706.backend.user.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.oauth.repository.OauthAccountRepository;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.auth.session.SessionTerminator;
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
    private final SessionTerminator sessionTerminator = mock(SessionTerminator.class);

    private final UserService service = new UserService(userRepository,
            mock(PointHistoryRepository.class), passwordEncoder, sessionTerminator,
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
    @DisplayName("비밀번호를 바꾸면 CREDENTIALS_CHANGED 사유로 현재 세션을 끝낸다")
    void terminatesTheSessionOnChange() {
        localUser();
        given(passwordEncoder.matches("old-pw", "hashed")).willReturn(true);

        service.changePassword(USER_ID, "old-pw", "Motok!2345abcd");

        // 토큰 폐기·소켓 종료·프레즌스 정리의 순서는 SessionTerminatorTest가 못박는다.
        // 사유는 여기서 리터럴로 고정한다 — DISPLACED로 잘못 넘기면 프론트가 "다른 곳에서 로그인" 안내를 띄운다.
        verify(sessionTerminator).terminate(USER_ID, SessionRevocationStore.Reason.CREDENTIALS_CHANGED);
    }

    @Test
    @DisplayName("현재 비밀번호가 틀리면 세션을 건드리지 않는다 — 남의 세션을 끊는 수단이 되면 안 된다")
    void keepsSessionWhenCurrentPasswordIsWrong() {
        localUser();
        given(passwordEncoder.matches(anyString(), anyString())).willReturn(false);

        assertThatThrownBy(() -> service.changePassword(USER_ID, "wrong-pw", "Motok!2345abcd"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVALID_CREDENTIALS);

        verify(sessionTerminator, never()).terminate(anyLong(), any());
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

        verify(sessionTerminator, never()).terminate(anyLong(), any());
    }
}
