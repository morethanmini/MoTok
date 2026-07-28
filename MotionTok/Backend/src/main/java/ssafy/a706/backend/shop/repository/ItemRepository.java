package ssafy.a706.backend.shop.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.shop.model.Item;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.model.ItemType;

import java.util.List;

public interface ItemRepository extends JpaRepository<Item, Long> {

    /** GET /shop/items — item_type=SHOP·is_active만, category는 선택 필터. */
    List<Item> findAllByItemTypeAndActiveTrue(ItemType itemType);

    List<Item> findAllByItemTypeAndCategoryAndActiveTrue(ItemType itemType, ItemCategory category);

    /** 기본 아이템 시드 멱등성 판별용 (ShopItemSeeder). */
    boolean existsByImageUrl(String imageUrl);
}
