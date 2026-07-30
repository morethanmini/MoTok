package ssafy.a706.backend.game;

/**
 * 게임 획득 포인트 계산(S15P11A706-83) — 순위·점수 기반 <b>순수 함수(DB 불필요)</b>.
 * GAME_END 방송 시점에 동기로 계산해 결과(GameResultEntry.pointsEarned)에 실어 보낸다.
 *
 * <p>지갑 반영은 {@code GameRewardListener} → {@code PointRewardService}가 이 값으로 처리한다
 * (POINT_HISTORY 적립 + users.point_balance 증가). 즉 이 값이 표시액이자 지급액이다.</p>
 */
public final class PointCalculator {

    /**
     * 한 판에 받을 수 있는 상한. 게임 종류와 무관하게 여기서 잘린다.
     *
     * <p><b>왜 두는가.</b> 점수는 클라이언트가 보고하고 서버는 상한으로만 걸러낸다
     * (리듬은 {@code MAX_SCORE = 91,200}). 그 상한이 정상 도달 점수보다 넉넉해서 점수를 위조하면
     * 실력 보너스가 정상 최고치의 몇 배까지 부풀 수 있다. 포인트에 상한을 따로 두면 리더보드 점수
     * 상한은 건드리지 않고(정상 고득점자를 자르지 않고) 보상만 막을 수 있다.</p>
     *
     * <p><b>계산 단계에서</b> 자른다 — 지급 시점에만 자르면 결과 화면은 큰 수를 보여 주고 지갑에는
     * 작은 수가 들어가 표시액과 지급액이 어긋난다.</p>
     */
    public static final int MAX_PER_ROUND = 100;

    private PointCalculator() {
    }

    /**
     * 순위 보상 + 점수 보너스. 상위 순위·높은 점수일수록 많이 받는다.
     *
     * @param rankNo      1부터의 순위
     * @param score       게임별 클램프된 점수(예: 핑거 스타 0~100)
     * @param playerCount 참가 인원(순위 보상 스케일)
     */
    public static int calc(int rankNo, int score, int playerCount) {
        int rankReward = Math.max(0, playerCount - rankNo + 1) * 10; // 1등 = playerCount*10, 꼴찌도 참가 보상 10
        int scoreBonus = Math.max(0, score) / 10;                    // 0~10
        // 8인 1등도 90이라 이 게임들은 상한에 닿지 않는다 — 방어선으로만 둔다
        return Math.min(MAX_PER_ROUND, rankReward + scoreBonus);
    }
}
