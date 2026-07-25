package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.repository.GameRankRedisRepository;

import java.util.Map;

/**
 * 게임 결과 정산 리스너(S15P11A706-117, write-behind).
 * {@link GameSettledEvent}를 <b>비동기</b>로 받아 leaderboards 적재 + rank ZSET 반영을 수행한다.
 * GAME_END 방송·게임 진행과 분리돼 있어(다른 스레드) 정산 지연·실패가 실시간 경로를 막지 않는다.
 *
 * <p>멱등: 발행 지점인 endRound가 Redis SETNX 가드로 이미 1회만 실행되고,
 * leaderboards는 (game_id,user_id) upsert라 재실행에도 결과가 안정적이다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GameSettlementListener {

    private final GameSettlementService settlementService;
    private final GameRankRedisRepository rankRepository;

    @Async("gameSettleExecutor")
    @EventListener
    public void onSettled(GameSettledEvent event) {
        try {
            // 결과 목록 = 종료 시점 세션 참가 전원(게스트 포함) — 1명 이하면 솔로 세션 기록(-96 확장)
            LeaderboardMode mode = LeaderboardMode.ofPlayerCount(event.results().size());
            Map<Long, Integer> bestByUser = settlementService.settleToDb(event.gameId(), mode, event.results());
            rankRepository.updateRanks(event.gameId(), mode, bestByUser);
            log.info("game settled: game={} mode={} members={}", event.gameId(), mode, bestByUser.size());
        } catch (Exception e) {
            // write-behind — 정산 실패를 실시간 경로로 전파하지 않는다. (후속: 재시도 큐 검토)
            log.error("game settlement failed: game={}", event.gameId(), e);
        }
    }
}
