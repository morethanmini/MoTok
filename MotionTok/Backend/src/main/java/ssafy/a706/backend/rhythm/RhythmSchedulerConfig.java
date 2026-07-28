package ssafy.a706.backend.rhythm;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * 캐치캐치리듬 라운드 종료 예약용 스케줄러.
 *
 * <p>기존 게임 스케줄러를 주입해 써도 되지만, 전용 빈을 두면 이 게임의 타이머 지연이
 * 다른 게임 정산에 영향을 주지 않고 로그에서도 스레드 이름으로 바로 구분된다.
 * 새 파일이라 충돌도 없다.</p>
 */
@Configuration
public class RhythmSchedulerConfig {

    @Bean
    public TaskScheduler rhythmTaskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        // 라운드 종료 예약만 처리한다 — 방이 여럿이어도 작업이 짧아 소수로 충분하다.
        scheduler.setPoolSize(2);
        scheduler.setThreadNamePrefix("rhythm-sched-");
        scheduler.setRemoveOnCancelPolicy(true);
        // 종료 시 진행 중인 정산은 마치고 내려간다.
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(5);
        return scheduler;
    }
}
