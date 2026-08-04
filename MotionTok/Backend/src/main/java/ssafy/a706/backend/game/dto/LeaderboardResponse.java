package ssafy.a706.backend.game.dto;

import ssafy.a706.backend.game.model.LeaderboardPeriod;

import java.time.LocalDate;
import java.util.List;

/**
 * GET /games/{gameId}/leaderboard 응답(-96, 명세 LeaderboardResponse).
 * myRank는 회원 본인 순위 — 게스트·비로그인·기록 없음이면 null.
 *
 * <p>weekStart는 WEEKLY일 때 <b>실제로 집계한 주</b>의 월요일이다(요청의 week는 그 주 아무 날이나
 * 받아 월요일로 스냅한다). 화면이 "8/3~8/9" 같은 라벨을 그리려면 서버가 어느 주를 보여줬는지
 * 알려 줘야 한다. ALLTIME이면 null.</p>
 */
public record LeaderboardResponse(
        long gameId,
        LeaderboardPeriod period,
        LocalDate weekStart,
        List<LeaderboardEntryResponse> entries,
        LeaderboardEntryResponse myRank
) {
}
