package ssafy.a706.backend.game.model;

/** Redis game:session:{roomId}:scores 해시에서 복원한 참가자 최종 점수(제출분). */
public record GamePlayerScore(
        String userId,
        String nickname,
        int score,
        int starsHit,
        long finishedAt
) {
}
