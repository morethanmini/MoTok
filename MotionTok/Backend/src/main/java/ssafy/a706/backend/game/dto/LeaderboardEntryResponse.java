package ssafy.a706.backend.game.dto;

/**
 * 리더보드 항목(-96, 명세 LeaderboardEntry). userId는 users.id — 회원만 적재되므로 항상 숫자다.
 *
 * <p>avatarUrl은 랭킹 표가 얼굴을 그리는 데 쓴다. 상위 N명의 User 행을 이미 한 번에 읽고 있어
 * 추가 조회가 없다({@code GameQueryService.leaderboard}).</p>
 */
public record LeaderboardEntryResponse(
        int rank,
        long userId,
        String nickname,
        int bestScore,
        int playCount,
        String avatarUrl
) {
}
