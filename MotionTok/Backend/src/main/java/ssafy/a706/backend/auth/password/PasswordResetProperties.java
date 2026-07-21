package ssafy.a706.backend.auth.password;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * application.yaml의 app.password-reset.*
 * linkBaseUrl은 재설정 화면 주소이며, 메일 링크는 linkBaseUrl + "?token={token}" 형태로 만든다.
 */
@ConfigurationProperties(prefix = "app.password-reset")
public record PasswordResetProperties(
        Duration tokenTtl,
        String linkBaseUrl
) {
}
