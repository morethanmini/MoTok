package ssafy.a706.backend.game.dto;

/**
 * GAME_END results 항목 — 순위 내림차순. finished=false는 미제출(이탈·타임아웃) 참가자.
 * pointsEarned는 순위·점수 기반 획득 포인트(-83, 표시용) — 지갑 실반영은 후속.
 *
 * <p>게임①(핑거 스타) 90초 매치: score=총점, completedCount=완성 개수(1순위 승부 기준,
 * 평균은 score/completedCount). 다른 게임은 completedCount가 null이다.</p>
 */
public record GameResultEntry(
        int rank,
        String userId,
        String nickname,
        int score,
        int starsHit,
        boolean finished,
        int pointsEarned,
        Integer completedCount
) {
}
