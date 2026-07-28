package ssafy.a706.backend.shop.repository.dto;

import ssafy.a706.backend.shop.model.ItemCategory;

import java.time.LocalDateTime;

/** 인벤토리 조회용 조인 결과 — user_item + item을 한 번에 읽는다(아이템별 재조회 N+1 방지). */
public record OwnedItemRow(
        Long itemId,
        String name,
        ItemCategory category,
        String imageUrl,
        LocalDateTime acquiredAt
) {}
