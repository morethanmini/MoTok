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

import java.time.LocalDateTime;

/**
 * 게임별 리더보드(ERD LEADERBOARD) — 게임 결과 정산의 <b>유일한 영속 원천</b>(S15P11A706-117).
 * 순위 정렬도 이 테이블이 권위다(예전엔 Redis ZSET이 맡았으나, 동점 tie-break를 점수 하나로는
 * 표현할 수 없어 걷어냈다 — {@code LeaderboardRepository} 참고).
 *
 * <p>회원(user_id)만 적재한다(게스트 제외 — 결정 D5). 솔로/멀티 세션 기록은 mode로 분리하며(-96 확장)
 * (game_id, user_id, mode) 유니크로 upsert 대상. 옛 유니크 제약(game_id, user_id) 제거는
 * {@code LeaderboardSchemaMigration} 참고. 감사 시각은 updated_at만(ERD) — 수동 관리.</p>
 */
@Entity
@Table(name = "leaderboards",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_leaderboard_game_user_mode", columnNames = {"game_id", "user_id", "mode"}),
        // 순위 조회(상위 N·내 순위)의 필터 컬럼까지만 건다. 정렬은 best_score DESC + best_achieved_at
        // ASC로 방향이 섞여 있어 한 인덱스로 못 덮는데, 필터로 잘린 뒤 남는 행이 적어 filesort가 더 싸다.
        indexes = @Index(name = "idx_leaderboard_board", columnList = "game_id, mode, best_score"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Leaderboard {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "game_id", nullable = false)
    private Long gameId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** SOLO | MULTI(-96 확장). default로 기존 배포 행은 전부 MULTI로 백필된다. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8, columnDefinition = "varchar(8) not null default 'MULTI'")
    private LeaderboardMode mode;

    @Column(name = "best_score", nullable = false)
    private int bestScore;

    /**
     * 지금의 best_score를 <b>처음 찍은</b> 시각 — 동점 tie-break 기준.
     *
     * <p>{@code updated_at}과 다르다. updated_at은 최고점이 안 올라도 매 판 갱신되므로, 그걸로
     * 순위를 가르면 점수가 오르지 않는데 계속 플레이한 사람이 자기 순위를 스스로 떨어뜨린다.</p>
     *
     * <p>기존 행은 부팅 마이그레이션이 updated_at으로 백필한다({@link
     * ssafy.a706.backend.game.LeaderboardSchemaMigration}) — 참값은 아니지만 남아 있는 유일한
     * 시각이고, 새 기록부터는 정확하다.</p>
     */
    @Column(name = "best_achieved_at", nullable = false)
    private LocalDateTime bestAchievedAt;

    @Column(name = "play_count", nullable = false)
    private int playCount;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public Leaderboard(Long gameId, Long userId, LeaderboardMode mode) {
        this.gameId = gameId;
        this.userId = userId;
        this.mode = mode;
        this.bestScore = 0;
        this.playCount = 0;
        // 첫 판이 0점이면 아래 record()의 갱신 조건에 걸리지 않는다 — 여기서 채워 두지 않으면 null이 남는다
        this.bestAchievedAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }

    /**
     * 한 판 반영 — 최고점 갱신(GREATEST) + 플레이수 증가.
     *
     * <p>달성 시각은 <b>{@code >}일 때만</b> 찍는다({@code >=} 아님). 같은 점수를 다시 내는 것은
     * 새 기록이 아니므로 동점 tie-break에서 앞줄로 당겨 주면 안 된다 — 같은 점수를 반복해서 내는
     * 것만으로 먼저 달성한 사람을 제칠 수 있게 된다.</p>
     */
    public void record(int score) {
        if (score > this.bestScore) {
            this.bestScore = score;
            this.bestAchievedAt = LocalDateTime.now();
        }
        this.playCount += 1;
        this.updatedAt = LocalDateTime.now();
    }
}
