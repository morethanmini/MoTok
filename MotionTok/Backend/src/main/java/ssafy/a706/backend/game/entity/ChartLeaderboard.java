package ssafy.a706.backend.game.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 채보(곡)별 최고점 랭킹 — <b>이벤트용이라 통째로 버릴 수 있게 만든 테이블</b>(S15P11A706-186).
 *
 * <p><b>왜 leaderboards에 chart_id를 넣지 않았나.</b> 그쪽 유니크를 바꾸면 되돌릴 때 같은
 * 유저·게임의 곡별 행들을 하나로 합쳐야 하는데, 어느 점수를 남길지 정할 수가 없어 데이터가
 * 깎인다. 이벤트는 언제든 접을 수 있어야 하므로 본 랭킹을 건드리지 않고 옆에 따로 쌓는다.
 * 폐기는 {@code DROP TABLE chart_leaderboard} 한 줄, 기간 리셋은 {@code DELETE} 한 줄이다.</p>
 *
 * <p>같은 판이 leaderboards·leaderboard_weekly에도 반영되므로 저장은 중복이다. 그게 의도다 —
 * 이 테이블을 버려도 본 랭킹이 멀쩡한 것이 "폐기 가능"의 조건이다. 유저당 1행이라 용량도
 * 문제되지 않는다.</p>
 *
 * <p><b>mode(솔로/멀티)를 나누지 않는다.</b> 리듬은 각자 치는 게임이라 혼자 하든 같이 하든
 * 점수의 의미가 같고, 이벤트는 "누가 만점을 찍었나" 하나만 본다. 나누면 시상 대상이 둘로
 * 갈려 기획과 어긋난다.</p>
 *
 * <p>정렬·동점 규칙은 본 랭킹과 같다 — {@code score DESC, achieved_at ASC, user_id ASC}.
 * 만점자가 여럿이면 먼저 찍은 사람이 위다.</p>
 */
@Entity
@Table(name = "chart_leaderboard",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_chart_leaderboard_game_chart_user",
                columnNames = {"game_id", "chart_id", "user_id"}),
        indexes = @Index(name = "idx_chart_leaderboard_board", columnList = "game_id, chart_id, best_score"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ChartLeaderboard {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "game_id", nullable = false)
    private Long gameId;

    /** 번들 채보 id — 프론트 자산 폴더명과 같다(예: ssafy-fighting-manual). */
    @Column(name = "chart_id", nullable = false, length = 64)
    private String chartId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "best_score", nullable = false)
    private int bestScore;

    /** 지금의 best_score를 처음 찍은 시각 — 동점 tie-break 기준(leaderboards와 같은 규칙). */
    @Column(name = "best_achieved_at", nullable = false)
    private LocalDateTime bestAchievedAt;

    /** 확인용 표시값. 순위에는 쓰이지 않는다. */
    @Column(name = "play_count", nullable = false)
    private int playCount;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public ChartLeaderboard(Long gameId, String chartId, Long userId) {
        this.gameId = gameId;
        this.chartId = chartId;
        this.userId = userId;
        this.bestScore = 0;
        this.playCount = 0;
        this.bestAchievedAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }

    /** 한 판 반영. 달성 시각은 최고점이 실제로 갱신될 때만 찍는다(leaderboards와 같은 규칙). */
    public void record(int score) {
        if (score > this.bestScore) {
            this.bestScore = score;
            this.bestAchievedAt = LocalDateTime.now();
        }
        this.playCount += 1;
        this.updatedAt = LocalDateTime.now();
    }
}
