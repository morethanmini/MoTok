package ssafy.a706.backend.global.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * 게임 세션 서버(S15P11A706-116)의 서버 권위 타이머용 스케줄러.
 * 라운드 종료 시각에 정산 브로드캐스트를 예약하는 용도라 풀은 작게 유지한다.
 *
 * <p>주의: 인메모리 스케줄이므로 simple broker와 동일하게 단일 인스턴스 전제.
 * 서버 재시작 시 예약이 사라지며, 이때 세션은 Redis TTL로 자연 소멸하고
 * 새 게임 시작 시 stale 세션을 덮어써 복구된다(GameSessionService 참고).</p>
 */
@Configuration
public class TaskSchedulingConfig {

    @Bean
    public TaskScheduler gameTaskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(2);
        scheduler.setThreadNamePrefix("game-timer-");
        scheduler.setRemoveOnCancelPolicy(true);
        return scheduler;
    }
}
