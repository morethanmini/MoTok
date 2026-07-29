package ssafy.a706.backend.auth.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * application.yaml의 app.rate-limit.* — 인증 엔드포인트 남용 방지 임계값.
 *
 * <p>코드가 아니라 설정에 둔 이유는 <b>환경마다 정답이 다르기</b> 때문이다. 여러 사람이 같은 공인
 * IP를 쓰는 망(학원·사내망)에서는 IP 기준 한도가 금방 차고, 시연 자리에서는 더 넉넉해야 한다.
 * 그럴 때 배포만 다시 하면 되도록 값을 밖으로 뺐다.</p>
 *
 * @param loginFailThreshold 이 횟수부터 로그인을 잠시 막는다. 오타 몇 번은 그냥 통과해야 한다
 * @param loginFailWindow    실패 카운터가 살아 있는 시간. 이 시간 동안 추가 실패가 없으면 처음부터 다시 센다
 * @param guestPerMinute     게스트 시작 IP당 분당 허용 횟수(순간 폭주 차단)
 * @param guestPerHour       게스트 시작 IP당 시간당 허용 횟수(지속 공격 차단)
 */
@ConfigurationProperties(prefix = "app.rate-limit")
public record RateLimitProperties(
        int loginFailThreshold,
        Duration loginFailWindow,
        int guestPerMinute,
        int guestPerHour
) {
}
