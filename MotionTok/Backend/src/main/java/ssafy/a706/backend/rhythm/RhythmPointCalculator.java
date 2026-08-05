package ssafy.a706.backend.rhythm;

import ssafy.a706.backend.game.PointCalculator;

/**
 * 캐치캐치리듬 전용 포인트 계산.
 *
 * <p>공용 {@code PointCalculator}를 쓰지 않는 이유: 그쪽은 점수가 0~100인 게임(별따라 손따라)을
 * 전제로 {@code scoreBonus = score/10} 을 쓴다. 리듬 점수는 원점수(만 단위)라 그대로 넣으면
 * 순위 보상이 무의미해질 만큼 보너스가 커진다. 포인트 공식은 -83 소유이므로 건드리지 않고
 * 이 게임 몫만 여기서 계산한다.</p>
 *
 * <pre>
 * points = min(실력 보너스 + 순위 보상, PointCalculator.MAX_PER_ROUND)
 *   실력 보너스 = round(score / SCORE_PER_POINT)   // HARD 전퍼펙트(~19,000) ≈ 48
 *   순위 보상   = (참가인원 - 순위) × RANK_STEP     // 8인 1등 = 42
 * </pre>
 * 실력과 순위가 비슷한 무게가 되도록 잡았다(전퍼펙트 1등에서 48 대 42).
 *
 * <p><b>정상 최고가 상한 아래에 있도록 계수를 잡았다.</b> 8인 1등 전퍼펙트가 48+42=90이고
 * 상한은 100이다({@link PointCalculator#MAX_PER_ROUND}) — 즉 상한은 정상 플레이를 자르지 않고
 * 점수 위조만 막는다(위조 시 실력 보너스가 228까지 부풀 수 있다). 90은 일반 게임의 8인 1등
 * 최대치와도 같아서 게임 간 보상 규모가 맞는다.</p>
 *
 * <p>수치는 M7에서 실측 후 재조정. 그때 SCORE_PER_POINT·RANK_STEP을 바꾸면
 * <b>정상 최고가 다시 상한을 넘지 않는지</b> 확인해야 한다.</p>
 */
public final class RhythmPointCalculator {

    /** 이 점수마다 1포인트 */
    private static final int SCORE_PER_POINT = 400;
    /**
     * 한 등수 차이당 포인트.
     *
     * <p>10에서 6으로 내렸다 — 10이면 8인 1등이 48+70=118로 상한(100)을 넘어 정상 최고 기록이
     * 잘렸다. 실력분(전퍼펙트 48)을 그대로 두고 순위분만 줄여 합계를 90으로 맞췄다.</p>
     */
    private static final int RANK_STEP = 6;

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
        return Math.min(PointCalculator.MAX_PER_ROUND, skillBonus + rankReward);
    }
}
