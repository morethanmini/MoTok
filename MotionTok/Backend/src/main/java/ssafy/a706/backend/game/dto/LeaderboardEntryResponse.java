package ssafy.a706.backend.game.dto;

/** 리더보드 항목(-96, 명세 LeaderboardEntry). userId는 users.id — 회원만 적재되므로 항상 숫자다. */
public record LeaderboardEntryResponse(
        int rank,
        long userId,
        String nickname,
        int bestScore,
        int playCount
) {
}
