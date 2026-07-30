package ssafy.a706.backend.global.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.SchedulingConfigurer;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.scheduling.config.ScheduledTaskRegistrar;

/**
 * {@code @Scheduled} 활성화. 처음에는 접속시간 스윕(-141) 하나뿐이라 conntime 패키지에 두고
 * "다른 도메인이 쓰게 되면 global로 승격"이라 적어 뒀는데, 로비 이벤트 coalescing(-148)과
 * 만료 방 청소가 붙으면서 그 시점이 왔다.
 *
 * <h4>전용 스케줄러를 명시하는 이유</h4>
 * 스프링은 {@code taskScheduler}라는 이름의 빈이 없고 {@code TaskScheduler} 타입 빈이 둘 이상이면
 * 조용히 <b>단일 스레드 풀백</b>으로 떨어진다. 지금 이 앱이 정확히 그 상태다(웹소켓 하트비트용과
 * 게임 세션용 스케줄러가 이미 있다). 한 스레드를 나눠 쓰면 접속시간 스윕이 회원 수만큼 DB를
 * 도는 동안 로비 flush가 밀려 "1초 창"이라는 상한이 깨진다 — 갱신이 수 초씩 튀는 형태로 드러난다.
 * 풀을 명시해 두면 빈이 하나 더 늘어도 동작이 달라지지 않는다.
 */
@Configuration
@EnableScheduling
public class SchedulingConfig implements SchedulingConfigurer {

    /**
     * 로비 flush(1초) · 접속시간 스윕(60초) · 만료 방 청소(5분) · AI 아이템 생성 타임아웃
     * 정리(1분, -102)가 서로를 밀지 않을 만큼.
     */
    private static final int POOL_SIZE = 4;

    @Override
    public void configureTasks(ScheduledTaskRegistrar registrar) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(POOL_SIZE);
        scheduler.setThreadNamePrefix("app-scheduler-");
        scheduler.setDaemon(true);
        scheduler.initialize();
        registrar.setTaskScheduler(scheduler);
    }
}
