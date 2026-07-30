package ssafy.a706.backend.auth.password;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.UUID;

/**
 * 비밀번호 재설정 (API 명세서 POST /auth/password/*).
 *  - reset-request: 계정 존재 노출을 막기 위해 결과와 무관하게 202. 계정이 있으면 1회용 토큰을
 *    Redis(auth:pwreset:{token}, TTL 30m)에 저장하고 재설정 링크 메일을 보낸다.
 *  - reset: 토큰을 1회 소비하고 새 비밀번호를 저장한다. 재설정 시 기존 Refresh 토큰을 무효화해 다른 세션을 로그아웃시킨다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PasswordResetService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final PwResetTokenStore tokenStore;
    private final PasswordResetMailSender mailSender;
    private final RefreshTokenStore refreshTokenStore;
    private final SessionRevocationStore sessionRevocationStore;
    private final PasswordResetProperties props;

    /** 재설정 요청. 존재 여부와 무관하게 호출부(컨트롤러)는 202를 반환한다. */
    public void requestReset(String rawEmail) {
        String email = rawEmail.trim().toLowerCase();
        userRepository.findByEmail(email).ifPresent(user -> {
            String token = UUID.randomUUID().toString();
            tokenStore.save(token, user.getId(), props.tokenTtl());
            try {
                mailSender.send(email, props.linkBaseUrl() + "?token=" + token);
            } catch (Exception e) {
                // 메일 발송 실패가 요청 자체를 실패(500)시키면 안 된다. 명세상 reset-request는 항상 202.
                log.warn("비밀번호 재설정 메일 발송 실패: {} ({})", email, e.getMessage());
            }
        });
    }

    /**
     * 재설정 확정. 토큰이 없거나 만료됐으면 400.
     *
     * <p>이 엔드포인트는 인증 없이 열려 있다(메일 링크로 들어온다). 그래서 여기서 끊는 세션은
     * 요청자의 것이 아니라 <b>그 계정에 지금 로그인해 있는 기기</b>의 것이다 — 비밀번호를 잃은 진짜 주인이
     * 되찾는 경로이자, 계정을 빼앗은 쪽을 밀어내는 경로다. Refresh만 지우면 상대의 액세스 토큰이
     * 만료(30분)까지 살아 그 창 동안 계정을 계속 쓸 수 있어, sid까지 폐기해 즉시 끊는다(v0.2.25 정책 확장).</p>
     */
    @Transactional
    public void resetPassword(String token, String newPassword) {
        Long userId = tokenStore.consume(token);
        if (userId == null) {
            throw new BusinessException(ErrorCode.PASSWORD_RESET_TOKEN_INVALID);
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.PASSWORD_RESET_TOKEN_INVALID));
        user.changePassword(passwordEncoder.encode(newPassword));
        // 폐기가 먼저 — sid는 아래 delete가 지울 Refresh 해시에 들어 있다.
        sessionRevocationStore.revokeCurrent(userId, SessionRevocationStore.Reason.CREDENTIALS_CHANGED);
        refreshTokenStore.delete(userId);
    }
}
