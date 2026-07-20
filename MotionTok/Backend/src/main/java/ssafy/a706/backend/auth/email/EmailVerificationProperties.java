package ssafy.a706.backend.auth.email;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** application.yaml의 app.email-verification.* */
@ConfigurationProperties(prefix = "app.email-verification")
public record EmailVerificationProperties(
        Duration codeTtl,
        Duration tokenTtl,
        Duration resendCooldown,
        int dailySendLimit,
        int maxVerifyAttempts,
        String from
) {
}
