package ssafy.a706.backend.shop.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.shop.model.Item;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.model.ItemType;

import java.util.List;

public interface ItemRepository extends JpaRepository<Item, Long> {

    /**
     * GET /shop/items — item_type=SHOP·is_active만, category는 선택 필터.
     *
     * <p><b>순서를 보장하지 않는다.</b> 화면에 나가는 순서는 {@code ShopService.DISPLAY_ORDER}가
     * 정한다 — 분류 순서가 DB로 표현되지 않아서다(그 이유는 그 상수 주석에 있다).
     * 새 호출부를 만들 때 여기 결과를 그대로 화면에 내보내면 조회마다 순서가 튄다.</p>
     */
    List<Item> findAllByItemTypeAndActiveTrue(ItemType itemType);

    List<Item> findAllByItemTypeAndCategoryAndActiveTrue(ItemType itemType, ItemCategory category);

    /** 기본 아이템 시드 멱등성 판별용 (ShopItemSeeder). */
    boolean existsByImageUrl(String imageUrl);
}
