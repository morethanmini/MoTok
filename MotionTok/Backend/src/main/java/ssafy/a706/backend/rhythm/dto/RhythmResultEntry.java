package ssafy.a706.backend.rhythm.dto;

/**
 * RHYTHM_END results 항목 — 점수 내림차순 순위.
 * finished=false는 미제출(이탈·타임아웃) 참가자로 0점 포함된다.
 * pointsEarned는 {@link ssafy.a706.backend.rhythm.RhythmPointCalculator} 산출값.
 */
public record RhythmResultEntry(
        int rank,
        String userId,
        String nickname,
        int score,
        int maxCombo,
        int perfect,
        int good,
        int miss,
        boolean finished,
        int pointsEarned
) {

    /** 정확도(%) — 표시용. 판정이 하나도 없으면 0. */
    public int accuracy() {
        int total = perfect + good + miss;
        return total == 0 ? 0 : Math.round((perfect + good) * 100f / total);
    }
}
