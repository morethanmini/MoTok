package ssafy.a706.backend.user.withdrawal;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;

/**
 * 탈퇴 후 재가입 제한 정책 (-111).
 * 탈퇴 시 식별자(이메일·소셜 계정)를 해시로 기록해 두고, 쿨다운(기본 7일) 안의 재가입 시도를 409로 막는다.
 *
 * 자체 가입은 이메일, 소셜은 "provider:providerUid"가 식별자다.
 * 같은 사람이 다른 이메일·다른 소셜 계정으로 가입하는 것은 막지 않는다(그건 애초에 다른 계정이다).
 */
@Component
@RequiredArgsConstructor
public class RejoinPolicy {

    private final WithdrawnAccountRepository withdrawnAccountRepository;
    private final WithdrawalProperties props;

    /** 쿨다운이 남아 있으면 409(AUTH_REJOIN_COOLDOWN). 남은 기간은 메시지가 아니라 정책 문서로 안내한다. */
    public void ensureRejoinable(String identifier, WithdrawnIdentifierType type) {
        withdrawnAccountRepository
                .findTopByIdentifierHashAndRejoinAvailableAtAfterOrderByRejoinAvailableAtDesc(
                        hash(normalize(identifier, type)), LocalDateTime.now())
                .ifPresent(blocked -> {
                    throw new BusinessException(ErrorCode.REJOIN_COOLDOWN);
                });
    }

    /** 탈퇴 시 호출 — 쿨다운 시작 기록을 남긴다. 같은 식별자의 과거 기록은 그대로 두고 새 행을 쌓는다. */
    @Transactional
    public void record(String identifier, WithdrawnIdentifierType type) {
        LocalDateTime now = LocalDateTime.now();
        withdrawnAccountRepository.save(WithdrawnAccount.of(
                hash(normalize(identifier, type)), type, now, now.plus(props.rejoinCooldown())));
    }

    public static String socialIdentifier(String provider, String providerUid) {
        return provider + ":" + providerUid;
    }

    /** 이메일만 대소문자를 무시한다. 소셜 UID는 provider가 준 값 그대로가 유일 키다. */
    private String normalize(String identifier, WithdrawnIdentifierType type) {
        String trimmed = identifier.trim();
        return type == WithdrawnIdentifierType.EMAIL ? trimmed.toLowerCase() : trimmed;
    }

    private String hash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", e);
        }
    }
}
