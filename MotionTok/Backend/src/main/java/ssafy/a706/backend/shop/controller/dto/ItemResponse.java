package ssafy.a706.backend.shop.controller.dto;

import ssafy.a706.backend.shop.model.Item;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.model.ItemType;

/** API 명세서 Item 스키마. */
public record ItemResponse(
        Long id,
        String name,
        ItemCategory category,
        ItemType itemType,
        Integer pricePoint,
        String imageUrl,
        boolean owned
) {
    public static ItemResponse of(Item item, boolean owned) {
        return new ItemResponse(
                item.getId(),
                item.getName(),
                item.getCategory(),
                item.getItemType(),
                item.getPricePoint(),
                item.getImageUrl(),
                owned);
    }
}
