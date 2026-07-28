package ssafy.a706.backend.shop.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 게임 보상 지급 기록 — "이 세션에서 이 사람에게 이미 줬다"는 사실만 담는다.
 *
 * <p>왜 POINT_HISTORY에 유니크를 걸지 않았나 — 세션 식별자가 UUID 문자열인데
 * POINT_HISTORY.ref_id는 bigint라 담을 수가 없다. 억지로 다른 값을 키로 쓰면
 * 무엇이 중복 판정 기준인지 흐려진다.</p>
 *
 * <p>발행 지점(endRound)이 Redis SETNX로 이미 1회만 실행되지만, 그건 Redis가 살아 있고
 * 키가 살아 있을 때의 이야기다. 포인트는 중복 지급이 곧 공짜 돈이라 DB 유니크로 한 번 더 막는다.</p>
 */
@Entity
@Table(name = "game_reward_grant",
        uniqueConstraints = @UniqueConstraint(columnNames = {"session_id", "user_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class GameRewardGrant {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false, length = 64)
    private String sessionId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "game_id", nullable = false)
    private long gameId;

    @Column(name = "points", nullable = false)
    private int points;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Builder
    public GameRewardGrant(String sessionId, Long userId, long gameId, int points) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.gameId = gameId;
        this.points = points;
        this.createdAt = LocalDateTime.now();
    }
}
