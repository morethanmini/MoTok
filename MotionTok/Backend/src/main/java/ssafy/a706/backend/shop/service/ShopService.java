package ssafy.a706.backend.shop.service;

import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.shop.controller.dto.ItemResponse;
import ssafy.a706.backend.shop.controller.dto.PurchaseResponse;
import ssafy.a706.backend.shop.model.Item;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.model.ItemType;
import ssafy.a706.backend.shop.model.PointHistory;
import ssafy.a706.backend.shop.model.PointHistoryType;
import ssafy.a706.backend.shop.model.UserItem;
import ssafy.a706.backend.shop.repository.ItemRepository;
import ssafy.a706.backend.shop.repository.PointHistoryRepository;
import ssafy.a706.backend.shop.repository.UserItemRepository;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ShopService {

    private final ItemRepository itemRepository;
    private final UserItemRepository userItemRepository;
    private final PointHistoryRepository pointHistoryRepository;
    private final UserRepository userRepository;

    /** GET /shop/items — item_type=SHOP·is_active만, category는 선택 필터. owned는 한 번에 조회해서 N+1을 피한다. */
    public List<ItemResponse> listItems(Long userId, ItemCategory category) {
        List<Item> items = category == null
                ? itemRepository.findAllByItemTypeAndActiveTrue(ItemType.SHOP)
                : itemRepository.findAllByItemTypeAndCategoryAndActiveTrue(ItemType.SHOP, category);
        Set<Long> ownedItemIds = userItemRepository.findItemIdsByUserId(userId);
        return items.stream()
                .map(item -> ItemResponse.of(item, ownedItemIds.contains(item.getId())))
                .toList();
    }

    /**
     * POST /shop/items/{itemId}/purchase — 포인트로 구매.
     * 순서: 존재·구매가능 확인(404) → 보유 여부 선체크(409, 불필요한 차감 방지) →
     * 원자적 포인트 차감(잔액부족 409) → UserItem 지급(UNIQUE 위반 시 동시요청 최종 방어, 409) → 내역 기록.
     */
    @Transactional
    public PurchaseResponse purchase(Long userId, Long itemId) {
        Item item = itemRepository.findById(itemId)
                .filter(i -> i.getItemType() == ItemType.SHOP && i.isActive())
                .orElseThrow(() -> new BusinessException(ErrorCode.ITEM_NOT_FOUND));

        if (userItemRepository.existsByUserIdAndItemId(userId, itemId)) {
            throw new BusinessException(ErrorCode.ITEM_ALREADY_OWNED);
        }

        int price = item.getPricePoint();
        int updated = userRepository.deductPointsIfSufficient(userId, price);
        if (updated == 0) {
            throw new BusinessException(ErrorCode.INSUFFICIENT_POINT);
        }

        try {
            userItemRepository.save(UserItem.builder().userId(userId).itemId(itemId).build());
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(ErrorCode.ITEM_ALREADY_OWNED);
        }

        int balanceAfter = userRepository.findById(userId).orElseThrow().getPointBalance();
        pointHistoryRepository.save(PointHistory.builder()
                .userId(userId)
                .amount(-price)
                .type(PointHistoryType.SHOP_PURCHASE)
                .refId(itemId)
                .balanceAfter(balanceAfter)
                .build());

        return new PurchaseResponse(itemId, balanceAfter);
    }
}
