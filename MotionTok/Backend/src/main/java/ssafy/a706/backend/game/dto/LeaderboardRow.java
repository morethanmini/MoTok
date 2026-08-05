package ssafy.a706.backend.game.dto;

import java.time.LocalDateTime;

/**
 * 순위표 한 줄의 조회 결과 — 리더보드 행과 회원 정보를 한 번에 읽는 JPQL 생성자 투영.
 *
 * <p>전체기간(leaderboards)과 주간 누적(leaderboard_weekly)이 <b>같은 모양</b>을 돌려주도록 공유한다.
 * 두 랭킹은 score의 의미(최고점 / 합계)와 achievedAt의 의미(최고점 달성 시각 / 그 합계에 도달한
 * 시각)만 다르고, 정렬 규칙과 화면 표현은 같다.</p>
 *
 * <p>탈퇴·정지 회원 제외를 SQL 조인에서 처리하므로 여기 담긴 건 이미 노출 대상뿐이다 — 조회 뒤
 * 걸러 내며 순위를 다시 매길 필요가 없다(-111).</p>
 */
public record LeaderboardRow(
        long userId,
        String nickname,
        String avatarUrl,
        /** 전체기간이면 최고점(int 범위), 주간이면 합계(long) — 넓은 쪽에 맞춘다. */
        long score,
        int playCount,
        LocalDateTime achievedAt
) {
}
