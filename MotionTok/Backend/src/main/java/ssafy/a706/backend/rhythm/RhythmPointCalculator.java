package ssafy.a706.backend.rhythm;

/**
 * 캐치캐치리듬 전용 포인트 계산.
 *
 * <p>공용 {@code PointCalculator}를 쓰지 않는 이유: 그쪽은 점수가 0~100인 게임(핑거 스타)을
 * 전제로 {@code scoreBonus = score/10} 을 쓴다. 리듬 점수는 원점수(만 단위)라 그대로 넣으면
 * 순위 보상이 무의미해질 만큼 보너스가 커진다. 포인트 공식은 -83 소유이므로 건드리지 않고
 * 이 게임 몫만 여기서 계산한다.</p>
 *
 * <pre>
 * points = 실력 보너스 + 순위 보상
 *   실력 보너스 = round(score / SCORE_PER_POINT)   // HARD 전퍼펙트(~19,000) ≈ 48
 *   순위 보상   = (참가인원 - 순위) × RANK_STEP     // 8인 1등 = 70
 * </pre>
 * 실력과 순위가 비슷한 무게가 되도록 잡았다. 수치는 M7에서 실측 후 재조정.
 */
public final class RhythmPointCalculator {

    /** 이 점수마다 1포인트 */
    private static final int SCORE_PER_POINT = 400;
    /** 한 등수 차이당 포인트 */
    private static final int RANK_STEP = 10;

    private RhythmPointCalculator() {
    }

    /**
     * @param rankNo      1부터 시작하는 순위
     * @param score       클램프된 최종 점수
     * @param playerCount 라운드 참가 인원
     */
    public static int calc(int rankNo, int score, int playerCount) {
        int skillBonus = Math.round((float) Math.max(0, score) / SCORE_PER_POINT);
        int rankReward = Math.max(0, playerCount - rankNo) * RANK_STEP;
        return skillBonus + rankReward;
    }
}
