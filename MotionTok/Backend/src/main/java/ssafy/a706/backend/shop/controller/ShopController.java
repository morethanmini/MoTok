package ssafy.a706.backend.shop.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.shop.controller.dto.ItemResponse;
import ssafy.a706.backend.shop.controller.dto.PurchaseResponse;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.service.ShopService;

import java.util.List;

/**
 * API 명세서 상점 도메인 — 아이템 목록·구매(-56).
 * AI 아이템 생성(/shop/ai-items, -102)은 후속 작업.
 * 게스트 차단은 SecurityConfig(/api/shop/** hasRole("USER"))가 필터 단에서 처리한다.
 */
@RestController
@RequestMapping("/api/shop")
@RequiredArgsConstructor
public class ShopController {

    private final ShopService shopService;

    /** GET /shop/items — 이름·이미지·가격·보유여부, item_type=SHOP만. */
    @GetMapping("/items")
    public List<ItemResponse> listItems(@AuthenticationPrincipal MemberPrincipal principal,
                                        @RequestParam(required = false) ItemCategory category) {
        return shopService.listItems(principal.id(), category);
    }

    /** POST /shop/items/{itemId}/purchase — 포인트로 구매. */
    @PostMapping("/items/{itemId}/purchase")
    public PurchaseResponse purchase(@AuthenticationPrincipal MemberPrincipal principal,
                                     @PathVariable Long itemId) {
        return shopService.purchase(principal.id(), itemId);
    }
}
