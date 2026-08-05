package ssafy.a706.backend.game.dto;

import java.time.LocalDateTime;

/**
 * 리더보드 항목(-96, 명세 LeaderboardEntry). userId는 users.id — 회원만 적재되므로 항상 숫자다.
 *
 * <p>avatarUrl은 랭킹 표가 얼굴을 그리는 데 쓴다. 순위표 조회가 users를 조인해 한 번에 읽으므로
 * 추가 조회가 없다({@link LeaderboardRow}).</p>
 *
 * <p>achievedAt은 이 점수를 <b>언제 찍었는지</b>다 — 동점을 가르는 기준이라 화면에 보여줄 수
 * 있어야 한다. 없으면 같은 점수인데 순위가 다른 두 줄을 사용자에게 설명할 방법이 없다.</p>
 *
 * <p>필드 이름이 {@code bestScore}가 아니라 <b>{@code score}</b>인 이유 — 주간 누적에서는 같은
 * 자리에 최고점이 아니라 <b>합계</b>가 담긴다. 기간에 따라 뜻이 달라지는 값에 한쪽 기간의 이름을
 * 붙여 두면 쓰는 쪽이 필드 이름만 보고 잘못 읽는다.</p>
 */
public record LeaderboardEntryResponse(
        int rank,
        long userId,
        String nickname,
        long score,
        int playCount,
        String avatarUrl,
        LocalDateTime achievedAt
) {

    public static LeaderboardEntryResponse of(int rank, LeaderboardRow row) {
        return new LeaderboardEntryResponse(rank, row.userId(), row.nickname(),
                row.score(), row.playCount(), row.avatarUrl(), row.achievedAt());
    }
}
