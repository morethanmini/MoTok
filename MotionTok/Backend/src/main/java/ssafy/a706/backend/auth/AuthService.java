package ssafy.a706.backend.auth;

import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.dto.GuestLoginRequest;
import ssafy.a706.backend.auth.dto.LoginRequest;
import ssafy.a706.backend.auth.dto.TokenResponse;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.User;
import ssafy.a706.backend.user.UserRepository;

import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider tokenProvider;

    public TokenResponse login(LoginRequest req) {
        User user = userRepository.findByUserId(req.userId())
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_CREDENTIALS));
        if (!passwordEncoder.matches(req.password(), user.getPassword())) {
            throw new BusinessException(ErrorCode.INVALID_CREDENTIALS);
        }
        String token = tokenProvider.createMemberToken(user.getUserId(), user.getNickname());
        return new TokenResponse(token, user.getUserId(), user.getNickname(), false);
    }

    public TokenResponse guestLogin(GuestLoginRequest req) {
        String guestId = "guest-" + UUID.randomUUID().toString().substring(0, 8);
        String token = tokenProvider.createGuestToken(guestId, req.nickname());
        return new TokenResponse(token, guestId, req.nickname(), true);
    }
}
