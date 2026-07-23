package ssafy.a706.backend.shop.model;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * ERD v0.2 ITEM 테이블.
 * pricePoint·creatorId는 AI_CUSTOM(-102, 이번 스코프 아님) 산출물에서만 쓰인다.
 */
@Entity
@Table(name = "item")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Item {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ItemCategory category;

    @Enumerated(EnumType.STRING)
    @Column(name = "item_type", nullable = false, length = 16)
    private ItemType itemType;

    @Column(name = "price_point")
    private Integer pricePoint;

    @Column(name = "image_url")
    private String imageUrl;

    @Column(name = "creator_id")
    private Long creatorId;

    @Column(name = "is_active", nullable = false)
    private boolean active;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Builder
    public Item(String name, ItemCategory category, ItemType itemType, Integer pricePoint,
                String imageUrl, Long creatorId, boolean active) {
        this.name = name;
        this.category = category;
        this.itemType = itemType;
        this.pricePoint = pricePoint;
        this.imageUrl = imageUrl;
        this.creatorId = creatorId;
        this.active = active;
        this.createdAt = LocalDateTime.now();
    }
}
