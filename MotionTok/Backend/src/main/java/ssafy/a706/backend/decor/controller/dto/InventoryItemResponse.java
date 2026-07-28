package ssafy.a706.backend.decor.controller.dto;

import ssafy.a706.backend.shop.model.ItemCategory;

import java.time.LocalDateTime;

/** API 명세서 InventoryItem 스키마 — 보유 아이템 1건. equipped는 decor_setting.config에서 파생된다. */
public record InventoryItemResponse(
        Long itemId,
        String name,
        ItemCategory category,
        String imageUrl,
        boolean equipped,
        LocalDateTime acquiredAt
) {}
