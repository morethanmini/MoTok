package ssafy.a706.backend.shop.model;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * ERD v0.2 USER_ITEM 테이블 — 보유(인벤토리) 기록.
 * (user_id, item_id) 복합 UNIQUE — 중복 구매를 DB 레벨에서 최종 방어한다.
 */
@Entity
@Table(name = "user_item", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "item_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "item_id", nullable = false)
    private Long itemId;

    @Column(name = "acquired_at", nullable = false, updatable = false)
    private LocalDateTime acquiredAt;

    @Builder
    public UserItem(Long userId, Long itemId) {
        this.userId = userId;
        this.itemId = itemId;
        this.acquiredAt = LocalDateTime.now();
    }
}
