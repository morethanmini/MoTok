package ssafy.a706.backend.game.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import ssafy.a706.backend.game.model.LeaderboardMode;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.TemporalAdjusters;

/**
 * 주간 누적 랭킹 — 한 주 동안 그 게임에서 얻은 점수의 <b>합</b>. 전체기간 최고점 랭킹(leaderboards)이
 * 실력의 명예의 전당이라면 이쪽은 참여의 랭킹이라, 상한 있는 게임에서도 매주 1위가 새로 정해진다.
 *
 * <p>정렬 규칙은 최고점 랭킹과 같다 — {@code score_sum DESC, updated_at ASC, user_id ASC}.
 * "같은 점수면 먼저 도달한 사람이 위"라는 한 가지 규칙인데, 누적에서 "먼저 도달한 시각"은 곧 그
 * 합계를 만든 마지막 판의 시각이라 updated_at이 그대로 기준이 된다(최고점 쪽이 별도 컬럼
 * best_achieved_at을 둬야 했던 것과 대비된다).</p>
 */
@Entity
@Table(name = "leaderboard_weekly",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_weekly_game_user_mode_week",
                columnNames = {"game_id", "user_id", "mode", "week_start"}),
        // 정렬은 score_sum DESC + updated_at ASC로 방향이 섞여 인덱스로 못 덮는다. week_start로 이미
        // 한 주치만 남으므로 필터까지만 걸고 정렬은 filesort에 맡긴다(최고점 쪽과 같은 판단).
        indexes = @Index(name = "idx_weekly_board", columnList = "game_id, mode, week_start"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LeaderboardWeekly {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "game_id", nullable = false)
    private Long gameId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private LeaderboardMode mode;

    /** 이 기록이 속한 주의 월요일(KST). 주 경계는 {@link #weekStartOf}가 유일한 기준이다. */
    @Column(name = "week_start", nullable = false)
    private LocalDate weekStart;

    /**
     * 이번 주 획득 점수 합. int로 두면 이론상 주 2만 판쯤에서 넘치는데, 그 상한을 계산해 두느니
     * long이 그냥 안전하다 — 넘칠 일이 없는 걸 확인하는 비용이 컬럼 폭보다 비싸다.
     */
    @Column(name = "score_sum", nullable = false)
    private long scoreSum;

    @Column(name = "play_count", nullable = false)
    private int playCount;

    /**
     * 마지막으로 합산한 세션 id — 같은 판이 두 번 더해지는 것을 막는 가드.
     *
     * <p>최고점(GREATEST)은 두 번 반영해도 값이 같아 멱등이지만 <b>합산은 아니다.</b> 지갑도 같은
     * 이유로 (session_id, user_id) 유니크를 따로 두고 있다({@code GameRewardListener}).</p>
     */
    @Column(name = "last_session_id", nullable = false, length = 64)
    private String lastSessionId;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public LeaderboardWeekly(Long gameId, Long userId, LeaderboardMode mode, LocalDate weekStart) {
        this.gameId = gameId;
        this.userId = userId;
        this.mode = mode;
        this.weekStart = weekStart;
        this.scoreSum = 0;
        this.playCount = 0;
        this.lastSessionId = "";
        this.updatedAt = LocalDateTime.now();
    }

    /**
     * 이 세션이 이미 합산됐는지.
     *
     * <p>ponytail: 직전 세션 하나만 기억한다. 비동기 리스너의 재실행은 즉시 일어나므로 이걸로
     * 막히지만, 세션 여러 개가 지나간 뒤의 재처리나 주 경계를 넘긴 재처리는 못 막는다. 거기까지
     * 필요해지면 지갑처럼 (session_id, user_id) 테이블을 따로 둔다.</p>
     */
    public boolean alreadyCounted(String sessionId) {
        return this.lastSessionId.equals(sessionId);
    }

    /** 한 판 합산. 호출 전에 {@link #alreadyCounted}로 걸러야 한다. */
    public void record(String sessionId, int score) {
        this.scoreSum += score;
        this.playCount += 1;
        this.lastSessionId = sessionId;
        this.updatedAt = LocalDateTime.now();
    }

    /** 그 날짜가 속한 주의 월요일. JVM 기본 시간대가 Asia/Seoul로 고정돼 있어 KST 기준이다. */
    public static LocalDate weekStartOf(LocalDate date) {
        return date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }

    /**
     * 지금이 속한 주의 월요일.
     *
     * <p>ponytail: 정산이 비동기라 자정 직전에 끝난 판이 다음 주로 집계될 수 있다. 초 단위
     * 어긋남이라 그냥 둔다 — 정확히 하려면 GameSettledEvent에 라운드 종료 시각을 실어야 한다.</p>
     */
    public static LocalDate currentWeekStart() {
        return weekStartOf(LocalDate.now());
    }
}
