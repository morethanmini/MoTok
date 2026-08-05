package ssafy.a706.backend.rhythm.model;

/**
 * 참가자 최종 제출 — 라운드당 1회만 수리된다.
 * 판정은 클라이언트가 하고 서버는 범위 클램프만 한다(별따라 손따라와 같은 신뢰 모델).
 */
public record RhythmPlayerScore(
        String userId,
        String nickname,
        int score,
        int maxCombo,
        int perfect,
        int good,
        int miss,
        long finishedAt
) {
}
