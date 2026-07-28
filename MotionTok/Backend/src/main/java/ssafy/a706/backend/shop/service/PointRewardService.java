package ssafy.a706.backend.shop.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.shop.model.GameRewardGrant;
import ssafy.a706.backend.shop.model.PointHistory;
import ssafy.a706.backend.shop.model.PointHistoryType;
import ssafy.a706.backend.shop.repository.GameRewardGrantRepository;
import ssafy.a706.backend.shop.repository.PointHistoryRepository;
import ssafy.a706.backend.user.repository.UserRepository;

/**
 * 게임 보상 포인트 적립(-83 연계).
 *
 * <p>지갑을 늘리는 유일한 통로다. 상점 차감(ShopService)과 같은 방식으로
 * 원자 UPDATE + 내역 기록을 한 트랜잭션에 묶는다.</p>
 *
 * <p><b>중복 지급 방지</b>는 두 겹이다 — 미리 확인(existsBy…)으로 대부분을 걸러 내고,
 * 동시에 들어온 경우는 (session_id, user_id) UNIQUE가 막는다. 사전 확인만으로는
 * 두 스레드가 동시에 통과할 수 있다.</p>
 *
 * <p>UNIQUE 위반을 <b>여기서 삼키지 않는</b> 이유 — 제약 위반이 나면 트랜잭션이 rollback-only가 되므로
 * 잡아 놓고 정상 반환하면 커밋 시점에 UnexpectedRollbackException이 터진다. 그대로 던져 트랜잭션을
 * 깨끗이 되돌리고, "이미 지급됨"이라는 해석은 호출 측(GameRewardListener)이 한다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PointRewardService {

    private final UserRepository userRepository;
    private final PointHistoryRepository pointHistoryRepository;
    private final GameRewardGrantRepository grantRepository;

    /**
     * 한 사람의 게임 보상 적립. 이미 지급했거나 대상이 아니면 아무 일도 하지 않는다.
     *
     * <p>참가자마다 별도 트랜잭션(REQUIRES_NEW)인 이유 — 한 사람 적립이 실패해도 나머지 참가자는
     * 받아야 한다. 한 트랜잭션으로 묶으면 마지막 한 명 때문에 전원 지급이 되돌아간다.</p>
     *
     * @return 실제로 적립했으면 true
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean grantGameReward(String sessionId, long gameId, Long userId, int points) {
        if (points <= 0 || userId == null) {
            return false; // 참가 보상이 0이면 내역만 늘어난다(게스트는 애초에 userId가 없다)
        }
        if (grantRepository.existsBySessionIdAndUserId(sessionId, userId)) {
            return false;
        }

        // 동시 요청이면 여기서 UNIQUE 위반이 나고 트랜잭션째 되돌아간다(호출 측이 중복으로 해석).
        grantRepository.saveAndFlush(GameRewardGrant.builder()
                .sessionId(sessionId).userId(userId).gameId(gameId).points(points).build());

        if (userRepository.addPoints(userId, points) == 0) {
            // 탈퇴 등으로 대상 행이 없으면 지급 기록만 남기고 끝낸다(잔액을 만들 수는 없다).
            log.warn("point reward skipped, user not found: user={} session={}", userId, sessionId);
            return false;
        }

        int balanceAfter = userRepository.findById(userId).orElseThrow().getPointBalance();
        pointHistoryRepository.save(PointHistory.builder()
                .userId(userId)
                .amount(points)
                .type(PointHistoryType.GAME_REWARD)
                // ref_id는 bigint라 UUID인 세션 id를 담을 수 없다 — 어떤 게임이었는지를 남긴다.
                // 세션 단위 추적은 game_reward_grant가 맡는다.
                .refId(gameId)
                .balanceAfter(balanceAfter)
                .build());
        return true;
    }
}
