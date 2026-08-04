package ssafy.a706.backend.game.model;

/**
 * 랭킹 집계 기간.
 *
 * <p>{@code ALLTIME} — 단일 판 최고 점수(leaderboards.best_score). 실력의 명예의 전당이라
 * 점수 상한이 있는 게임에서는 상위권이 사실상 굳는다. 그게 이 랭킹의 성격이다.</p>
 *
 * <p>{@code WEEKLY} — 한 주 획득 점수의 합(leaderboard_weekly.score_sum). 매주 초기화되므로
 * 굳지 않고, 많이 플레이한 사람이 올라간다. 위 랭킹이 굳는 것에 대한 짝이다.</p>
 */
public enum LeaderboardPeriod {
    ALLTIME, WEEKLY
}
