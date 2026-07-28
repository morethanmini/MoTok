package ssafy.a706.backend.conntime.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * {@code @Scheduled} 활성화(-141 접속시간 스윕). 앱에 스케줄링 사용처가 여기뿐이라
 * 전역 설정이 아닌 이 도메인 패키지에 둔다 — 다른 도메인이 쓰게 되면 global로 승격.
 */
@Configuration
@EnableScheduling
public class ConnectTimeSchedulingConfig {
}
