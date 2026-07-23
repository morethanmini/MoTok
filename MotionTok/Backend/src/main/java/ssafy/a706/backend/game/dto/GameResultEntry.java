package ssafy.a706.backend.game.dto;

/**
 * GAME_END results 항목 — 점수 내림차순 순위. finished=false는 미제출(이탈·타임아웃) 참가자.
 * pointsEarned는 순위·점수 기반 획득 포인트(-83, 표시용) — 지갑 실반영은 후속.
 */
public record GameResultEntry(
        int rank,
        String userId,
        String nickname,
        int score,
        int starsHit,
        boolean finished,
        int pointsEarned
) {
}
