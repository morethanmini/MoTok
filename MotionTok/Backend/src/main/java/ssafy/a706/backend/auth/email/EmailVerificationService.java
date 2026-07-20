package ssafy.a706.backend.auth.email;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.controller.dto.EmailVerifyResult;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.repository.UserRepository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.UUID;

/**
 * 회원가입 이메일 인증 (API 명세서 v0.2.1).
 *
 * Redis 키:
 *   auth:email:code:{email}      Hash   TTL 5m   인증번호 해시 + 검증 시도 횟수
 *   auth:email:verified:{token}  String TTL 5m   인증 완료 토큰 → 이메일. 가입 시 1회 소비
 *   auth:email:cooldown:{email}  String TTL 60s  재발송 쿨다운
 *   auth:email:sent:{email}:{날짜} String TTL 24h 1일 발송 횟수
 */
@Service
@RequiredArgsConstructor
public class EmailVerificationService {

    private static final String KEY_CODE = "auth:email:code:";
    private static final String KEY_VERIFIED = "auth:email:verified:";
    private static final String KEY_COOLDOWN = "auth:email:cooldown:";
    private static final String KEY_SENT = "auth:email:sent:";

    private static final String FIELD_CODE_HASH = "codeHash";
    private static final String FIELD_ATTEMPTS = "attempts";

    private static final SecureRandom RANDOM = new SecureRandom();

    private final StringRedisTemplate redis;
    private final UserRepository userRepository;
    private final VerificationMailSender mailSender;
    private final EmailVerificationProperties props;

    /** 인증번호 발송 — 중복 가입 차단, 쿨다운·1일 한도 검사 후 6자리 코드를 메일로 보낸다. */
    public void sendCode(String rawEmail) {
        String email = normalize(rawEmail);

        if (userRepository.existsByEmail(email)) {
            throw new BusinessException(ErrorCode.EMAIL_ALREADY_REGISTERED);
        }
        if (Boolean.TRUE.equals(redis.hasKey(KEY_COOLDOWN + email))) {
            throw new BusinessException(ErrorCode.RESEND_COOLDOWN);
        }
        if (incrementDailyCount(email) > props.dailySendLimit()) {
            throw new BusinessException(ErrorCode.SEND_LIMIT_EXCEEDED);
        }

        String code = generateCode();
        String codeKey = KEY_CODE + email;
        redis.delete(codeKey);
        redis.opsForHash().put(codeKey, FIELD_CODE_HASH, hash(code));
        redis.opsForHash().put(codeKey, FIELD_ATTEMPTS, "0");
        redis.expire(codeKey, props.codeTtl());

        redis.opsForValue().set(KEY_COOLDOWN + email, "1", props.resendCooldown());

        mailSender.send(email, code);
    }

    /** 인증번호 검증 — 성공 시 가입에 쓸 1회용 verificationToken을 발급한다. */
    public EmailVerifyResult verifyCode(String rawEmail, String code) {
        String email = normalize(rawEmail);
        String codeKey = KEY_CODE + email;

        Object storedHash = redis.opsForHash().get(codeKey, FIELD_CODE_HASH);
        if (storedHash == null) {
            throw new BusinessException(ErrorCode.VERIFICATION_CODE_INVALID);
        }

        Long attempts = redis.opsForHash().increment(codeKey, FIELD_ATTEMPTS, 1);
        if (attempts != null && attempts > props.maxVerifyAttempts()) {
            redis.delete(codeKey);
            throw new BusinessException(ErrorCode.VERIFY_ATTEMPT_EXCEEDED);
        }

        if (!constantTimeEquals(storedHash.toString(), hash(code))) {
            throw new BusinessException(ErrorCode.VERIFICATION_CODE_INVALID);
        }

        redis.delete(codeKey);

        String token = UUID.randomUUID().toString();
        redis.opsForValue().set(KEY_VERIFIED + token, email, props.tokenTtl());
        return new EmailVerifyResult(token, props.tokenTtl().toSeconds());
    }

    /**
     * 가입 시 인증 토큰을 1회 소비한다.
     * 토큰이 없거나 만료됐거나, 인증한 이메일과 가입 이메일이 다르면 거절한다.
     */
    public void consumeToken(String token, String rawEmail) {
        String email = normalize(rawEmail);
        String key = KEY_VERIFIED + token;

        String verifiedEmail = redis.opsForValue().getAndDelete(key);
        if (verifiedEmail == null || !verifiedEmail.equals(email)) {
            throw new BusinessException(ErrorCode.VERIFICATION_TOKEN_INVALID);
        }
    }

    private long incrementDailyCount(String email) {
        String key = KEY_SENT + email + ":" + LocalDate.now();
        Long count = redis.opsForValue().increment(key);
        if (count != null && count == 1L) {
            redis.expire(key, Duration.ofDays(1));
        }
        return count == null ? 1L : count;
    }

    private String generateCode() {
        return String.format("%06d", RANDOM.nextInt(1_000_000));
    }

    private String hash(String code) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(code.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", e);
        }
    }

    private boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    private String normalize(String email) {
        return email.trim().toLowerCase();
    }
}
