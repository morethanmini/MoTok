package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.game.dto.GameResultEntry;
import ssafy.a706.backend.shop.service.PointRewardService;

/**
 * 게임 보상 포인트 지급(-83 지갑 연계).
 *
 * <p>{@link GameSettledEvent}를 비동기로 받아 결과의 pointsEarned를 실제 잔액에 반영한다.
 * 리더보드 적재({@link GameSettlementListener})와 <b>리스너를 나눈 이유</b> — 둘은 실패해도
 * 되는 정도가 다르다. 포인트 지급이 실패했다고 전적이 안 남으면 안 되고, 그 반대도 마찬가지다.</p>
 *
 * <p>게스트는 userId가 숫자가 아니라 지급 대상에서 빠진다(리더보드와 같은 기준).</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GameRewardListener {

    private final PointRewardService pointRewardService;

    @Async("gameSettleExecutor")
    @EventListener
    public void onSettled(GameSettledEvent event) {
        int granted = 0;
        for (GameResultEntry result : event.results()) {
            Long userId = memberId(result.userId());
            if (userId == null) {
                continue; // 게스트 — 지갑이 없다
            }
            try {
                if (pointRewardService.grantGameReward(
                        event.sessionId(), event.gameId(), userId, result.pointsEarned())) {
                    granted++;
                }
            } catch (DataIntegrityViolationException e) {
                // (session_id, user_id) UNIQUE 위반 = 같은 세션이 동시에 두 번 정산된 경우.
                // 막으려던 상황이 실제로 막힌 것이라 오류가 아니다.
                log.debug("point reward already granted: session={} user={}", event.sessionId(), userId);
            } catch (Exception e) {
                // 한 사람 실패가 나머지 지급을 막지 않는다(참가자별 트랜잭션).
                log.error("point reward failed: session={} user={}", event.sessionId(), userId, e);
            }
        }
        log.info("game reward granted: session={} game={} users={}",
                event.sessionId(), event.gameId(), granted);
    }

    /** 회원 id는 숫자 문자열, 게스트는 아니다(GameSettlementService와 같은 판정). */
    private Long memberId(String participantId) {
        try {
            return Long.parseLong(participantId);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
