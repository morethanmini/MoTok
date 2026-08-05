package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.game.model.LeaderboardMode;

/**
 * 게임 결과 정산 리스너(S15P11A706-117, write-behind).
 * {@link GameSettledEvent}를 <b>비동기</b>로 받아 최고점·주간 누적 적재를 수행한다.
 * GAME_END 방송·게임 진행과 분리돼 있어(다른 스레드) 정산 지연·실패가 실시간 경로를 막지 않는다.
 *
 * <p>적재는 {@link GameSettlementService#settleToDb} 한 트랜잭션 안에서 끝난다 — 최고점만 들어가고
 * 주간 합계가 빠지는 부분 실패가 없어야 한다. 최고점은 다음에 더 높은 점수를 내면 복구되지만
 * <b>합계는 한 번 놓치면 영영 안 채워진다</b>(판 단위 기록을 남기지 않아 재계산할 원본이 없다).</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GameSettlementListener {

    private final GameSettlementService settlementService;

    @Async("gameSettleExecutor")
    @EventListener
    public void onSettled(GameSettledEvent event) {
        try {
            // 결과 목록 = 종료 시점 세션 참가 전원(게스트 포함) — 1명 이하면 솔로 세션 기록(-96 확장)
            LeaderboardMode mode = LeaderboardMode.ofPlayerCount(event.results().size());
            int members = settlementService.settleToDb(
                    event.sessionId(), event.gameId(), event.chartId(), mode, event.results());
            log.info("game settled: game={} mode={} chart={} members={}",
                    event.gameId(), mode, event.chartId(), members);
        } catch (Exception e) {
            // write-behind — 정산 실패를 실시간 경로로 전파하지 않는다. (후속: 재시도 큐 검토)
            log.error("game settlement failed: game={}", event.gameId(), e);
        }
    }
}
