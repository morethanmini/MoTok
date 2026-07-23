package ssafy.a706.backend.user.withdrawal;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** application.yaml의 app.withdrawal.* */
@ConfigurationProperties(prefix = "app.withdrawal")
public record WithdrawalProperties(
        /** 탈퇴 후 같은 식별자로 다시 가입할 수 있게 되기까지의 기간(정책상 1주일). */
        Duration rejoinCooldown
) {
}
