package ssafy.a706.backend.shop.model;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/** ERD v0.2 POINT_HISTORY 테이블 — 포인트 적립/사용 내역. amount는 +적립/-사용. */
@Entity
@Table(name = "point_history")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PointHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false)
    private int amount;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private PointHistoryType type;

    @Column(name = "ref_id")
    private Long refId;

    @Column(name = "balance_after", nullable = false)
    private int balanceAfter;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Builder
    public PointHistory(Long userId, int amount, PointHistoryType type, Long refId, int balanceAfter) {
        this.userId = userId;
        this.amount = amount;
        this.type = type;
        this.refId = refId;
        this.balanceAfter = balanceAfter;
        this.createdAt = LocalDateTime.now();
    }
}
