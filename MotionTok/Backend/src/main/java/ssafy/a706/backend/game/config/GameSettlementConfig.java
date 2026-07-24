package ssafy.a706.backend.game.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * 게임 결과 정산(S15P11A706-117)용 비동기 실행기.
 * GAME_END 방송 스레드를 막지 않도록 정산(DB 적재·rank 반영)을 별도 풀에서 돌린다(write-behind).
 */
@Configuration
@EnableAsync
public class GameSettlementConfig {

    @Bean
    public Executor gameSettleExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("game-settle-");
        executor.initialize();
        return executor;
    }
}
