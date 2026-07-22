package ssafy.a706.backend.rtc;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * application.yaml의 turn.* — coturn 접속 정보.
 * secret은 coturn의 static-auth-secret과 동일해야 한다(불일치 시 릴레이 인증 실패).
 */
@ConfigurationProperties(prefix = "turn")
public record TurnProperties(
        String host,
        int port,
        String secret,
        long credentialTtlSeconds
) {
}
