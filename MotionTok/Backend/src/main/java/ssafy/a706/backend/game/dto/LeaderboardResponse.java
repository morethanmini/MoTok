package ssafy.a706.backend.game.dto;

import java.util.List;

/**
 * GET /games/{gameId}/leaderboard 응답(-96, 명세 LeaderboardResponse).
 * myRank는 회원 본인 순위 — 게스트·비로그인·기록 없음이면 null.
 */
public record LeaderboardResponse(
        long gameId,
        List<LeaderboardEntryResponse> entries,
        LeaderboardEntryResponse myRank
) {
}
