package ssafy.a706.backend.game;

/**
 * 게임 획득 포인트 계산(S15P11A706-83) — 순위·점수 기반 <b>순수 함수(DB 불필요)</b>.
 * GAME_END 방송 시점에 동기로 계산해 결과(GameResultEntry.pointsEarned)에 실어 보낸다(표시용).
 *
 * <p>포인트 <b>지갑 실반영</b>(POINT_HISTORY·users.point_balance)은 이 단계 범위 밖 —
 * 포인트 도메인(마이페이지) 소유권 확정 후 연계한다. 지금은 계산·표시까지.</p>
 */
public final class PointCalculator {

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
        return rankReward + scoreBonus;
    }
}
