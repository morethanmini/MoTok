package ssafy.a706.backend.shop.model;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * AI 아이템 생성 큐 작업 (-102). GPU 워커는 외부에서 호출할 수 없어 폴링 구조로 간다 —
 * 생성 요청은 즉시 처리되지 않고 여기 쌓였다가 워커가 /api/internal/ai-jobs/next로 가져간다.
 * Item/UserItem과 같은 스타일로 연관관계 어노테이션 없이 순수 ID 컬럼만 쓴다.
 */
@Entity
@Table(name = "ai_item_job")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AiItemJob {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, length = 20)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ItemCategory category;

    @Column(name = "sketch_base64", nullable = false, columnDefinition = "LONGTEXT")
    private String sketchBase64;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private AiJobStatus status;

    /** 생성 완료 시 워커가 올린 이미지 URL. Item과 무관하게 job 자체가 보관한다 — "생성 → 확인 → 저장" 흐름에서
     * 저장 전에도 프론트가 결과 미리보기를 받아야 하기 때문이다. */
    @Column(name = "image_url", length = 512)
    private String imageUrl;

    /** 유저가 저장을 확정해 생성된 Item의 id. 저장 전(또는 재시도로 버려진 경우)에는 null. */
    @Column(name = "item_id")
    private Long itemId;

    @Column(name = "error_message", length = 500)
    private String errorMessage;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Builder
    public AiItemJob(Long userId, String name, ItemCategory category, String sketchBase64, AiJobStatus status) {
        this.userId = userId;
        this.name = name;
        this.category = category;
        this.sketchBase64 = sketchBase64;
        this.status = status;
        this.createdAt = LocalDateTime.now();
    }
}
