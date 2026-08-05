package ssafy.a706.backend.game.model;

import java.util.Map;

/**
 * Redis game:session:{roomId}:scores 해시에서 복원한 참가자 최종 점수(제출분).
 *
 * <p>stats는 게임별 부가 지표(S15P11A706-137에서 일반화) — 게임①: starsHit,
 * 게임④: 라운드별 등급 카운트 등. 순위·정산은 score만 쓰고 stats는 표시용이다.</p>
 */
public record GamePlayerScore(
        String userId,
        String nickname,
        int score,
        Map<String, Integer> stats,
        long finishedAt
) {
    /** 게임①(별따라 손따라) 레거시 표기 — GAME_END results의 starsHit 필드를 채운다. */
    public int starsHit() {
        return stats.getOrDefault("starsHit", 0);
    }

    /** 게임①(별따라 손따라) 60초 매치 완성 개수 — 1순위 순위 기준. 다른 게임은 0. */
    public int completedCount() {
        return stats.getOrDefault("completedCount", 0);
    }
}
