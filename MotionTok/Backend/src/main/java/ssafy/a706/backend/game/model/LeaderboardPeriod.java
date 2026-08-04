package ssafy.a706.backend.game.model;

/**
 * 랭킹 집계 기간.
 *
 * <p>{@code ALLTIME} — 단일 판 최고 점수(leaderboards.best_score). 실력의 명예의 전당이라
 * 점수 상한이 있는 게임에서는 상위권이 사실상 굳는다. 그게 이 랭킹의 성격이다.</p>
 *
 * <p>{@code WEEKLY} — 한 주 획득 점수의 합(leaderboard_weekly.score_sum). 매주 초기화되므로
 * 굳지 않고, 많이 플레이한 사람이 올라간다. 위 랭킹이 굳는 것에 대한 짝이다.</p>
 *
 * <p>{@code CHART} — 특정 채보(곡)만 따로 세운 최고점 랭킹. 기간이 아니라 대상이 다른 거라
 * 이름과 어긋나지만, 화면에서 셋이 나란한 탭 하나로 쓰이므로 같은 축에 둔다. <b>이벤트용이라
 * 통째로 버릴 수 있게</b> 별도 테이블(chart_leaderboard)에 쌓는다 — 접을 때 이 값과
 * ChartLeaderboard* 파일들만 지우면 된다(S15P11A706-186).</p>
 */
public enum LeaderboardPeriod {
    ALLTIME, WEEKLY, CHART
}
