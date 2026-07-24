package ssafy.a706.backend.game.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import ssafy.a706.backend.game.model.LeaderboardMode;

import java.time.LocalDateTime;

/**
 * 게임별 리더보드(ERD LEADERBOARD) — 게임 결과 정산의 <b>유일한 영속 원천</b>(S15P11A706-117).
 * 라이브 랭킹 Redis {@code rank:{gameId}[:solo]}(ZSET)가 유실돼도 이 테이블로 warm-up 복구한다.
 *
 * <p>회원(user_id)만 적재한다(게스트 제외 — 결정 D5). 솔로/멀티 세션 기록은 mode로 분리하며(-96 확장)
 * (game_id, user_id, mode) 유니크로 upsert 대상. 옛 유니크 제약(game_id, user_id) 제거는
 * {@code LeaderboardSchemaMigration} 참고. 감사 시각은 updated_at만(ERD) — 수동 관리.</p>
 */
@Entity
@Table(name = "leaderboards", uniqueConstraints =
        @UniqueConstraint(name = "uk_leaderboard_game_user_mode", columnNames = {"game_id", "user_id", "mode"}))
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
        this.updatedAt = LocalDateTime.now();
    }

    /** 한 판 반영 — 최고점 갱신(GREATEST) + 플레이수 증가. */
    public void record(int score) {
        this.bestScore = Math.max(this.bestScore, score);
        this.playCount += 1;
        this.updatedAt = LocalDateTime.now();
    }
}
