package ssafy.a706.backend.auth.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.auth.controller.dto.*;
import ssafy.a706.backend.auth.email.EmailVerificationService;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;

import java.time.Duration;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider tokenProvider;
    private final RefreshTokenStore refreshTokenStore;
    private final EmailVerificationService emailVerificationService;

    public AvailabilityResponse checkEmail(String email) {
        return new AvailabilityResponse(!userRepository.existsByEmail(email.trim().toLowerCase()));
    }

    public AvailabilityResponse checkNickname(String nickname) {
        return new AvailabilityResponse(!userRepository.existsByNickname(nickname.trim()));
    }

    /** 아이디(이메일) 찾기 — 닉네임으로 가입 계정을 찾아 일부 마스킹된 이메일을 돌려준다. 없으면 404. */
    public FindIdResponse findId(String nickname) {
        User user = userRepository.findByNickname(nickname.trim())
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
        if (user.getEmail() == null) {
            throw new BusinessException(ErrorCode.USER_NOT_FOUND); // 소셜 전용 계정은 이메일이 없다
        }
        return new FindIdResponse(maskEmail(user.getEmail()));
    }

    /** 이메일 로컬 파트 일부를 가린다. 예: abcde@x.com → ab***@x.com */
    private String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 0) {
            return "***";
        }
        String local = email.substring(0, at);
        String head = local.length() <= 2 ? local.substring(0, 1) : local.substring(0, 2);
        return head + "***" + email.substring(at);
    }

    /**
     * 회원가입. 이메일 인증 토큰을 먼저 소비하므로 인증을 거치지 않은 요청은 여기서 막힌다.
     * 중복 검사와 INSERT 사이의 경합은 UNIQUE 제약 위반을 잡아 409로 변환해 처리한다.
     */
    @Transactional
    public UserProfileResponse signup(SignupRequest req) {
        String email = req.email().trim().toLowerCase();
        String nickname = req.nickname().trim();

        emailVerificationService.consumeToken(req.verificationToken(), email);

        if (userRepository.existsByEmail(email)) {
            throw new BusinessException(ErrorCode.EMAIL_ALREADY_REGISTERED);
        }
        if (userRepository.existsByNickname(nickname)) {
            throw new BusinessException(ErrorCode.NICKNAME_ALREADY_USED);
        }

        User user = User.builder()
                .email(email)
                .passwordHash(passwordEncoder.encode(req.password()))
                .nickname(nickname)
                .build();
        try {
            return UserProfileResponse.from(userRepository.saveAndFlush(user));
        } catch (DataIntegrityViolationException e) {
            // 동시 가입으로 UNIQUE 제약에 걸린 경우
            throw new BusinessException(
                    userRepository.existsByEmail(email)
                            ? ErrorCode.EMAIL_ALREADY_REGISTERED
                            : ErrorCode.NICKNAME_ALREADY_USED);
        }
    }

    @Transactional
    public TokenResponse login(LoginRequest req) {
        User user = userRepository.findByEmail(req.email().trim().toLowerCase())
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_CREDENTIALS));

        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(req.password(), user.getPasswordHash())) {
            throw new BusinessException(ErrorCode.INVALID_CREDENTIALS);
        }
        if (!user.isActive()) {
            throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        }
        return issueTokens(user);
    }

    /** Refresh 토큰으로 Access 재발급. 저장된 토큰과 일치할 때만 허용하고, 발급 시 회전시킨다. */
    @Transactional
    public TokenResponse refresh(RefreshRequest req) {
        Claims claims;
        try {
            claims = tokenProvider.parse(req.refreshToken());
        } catch (JwtException | IllegalArgumentException e) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }
        if (!tokenProvider.isRefresh(claims)) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }

        Long userId = Long.valueOf(claims.getSubject());
        if (!refreshTokenStore.matches(userId, req.refreshToken())) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_TOKEN));
        if (!user.isActive()) {
            throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        }
        return issueTokens(user);
    }

    /** 로그아웃 — Redis에서 Refresh 토큰을 지우는 것이 곧 서버측 무효화다. */
    public void logout(Long userId) {
        refreshTokenStore.delete(userId);
    }

    public TokenResponse guestLogin(GuestLoginRequest req) {
        String guestId = "guest-" + UUID.randomUUID().toString().substring(0, 8);
        String accessToken = tokenProvider.createGuestToken(guestId, req.nickname());
        return TokenResponse.of(accessToken, null, tokenProvider.accessExpiresInSeconds(), null);
    }

    private TokenResponse issueTokens(User user) {
        String accessToken = tokenProvider.createAccessToken(user.getId(), user.getNickname());
        String refreshToken = tokenProvider.createRefreshToken(user.getId());
        refreshTokenStore.save(user.getId(), refreshToken,
                Duration.ofMillis(tokenProvider.getRefreshExpirationMs()));
        return TokenResponse.of(accessToken, refreshToken,
                tokenProvider.accessExpiresInSeconds(), UserProfileResponse.from(user));
    }
}
