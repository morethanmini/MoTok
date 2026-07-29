package ssafy.a706.backend.shop.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.shop.controller.dto.AiItemJobCreateRequest;
import ssafy.a706.backend.shop.controller.dto.AiItemJobCreateResponse;
import ssafy.a706.backend.shop.controller.dto.AiItemJobStatusResponse;
import ssafy.a706.backend.shop.controller.dto.AiItemSaveResponse;
import ssafy.a706.backend.shop.controller.dto.ItemResponse;
import ssafy.a706.backend.shop.controller.dto.PurchaseResponse;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.service.AiItemJobService;
import ssafy.a706.backend.shop.service.ShopService;

import java.util.List;

/**
 * API 명세서 상점 도메인 — 아이템 목록·구매(-56), AI 아이템 생성 요청·조회(-102).
 * 게스트 차단은 SecurityConfig(/api/shop/** hasRole("USER"))가 필터 단에서 처리한다.
 */
@RestController
@RequestMapping("/api/shop")
@RequiredArgsConstructor
public class ShopController {

    private final ShopService shopService;
    private final AiItemJobService aiItemJobService;

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

    /** POST /shop/ai-items — AI 아이템 생성 요청을 큐에 쌓는다. GPU 워커가 폴링해 비동기로 처리한다. */
    @PostMapping("/ai-items")
    public AiItemJobCreateResponse createAiItemJob(@AuthenticationPrincipal MemberPrincipal principal,
                                                   @Valid @RequestBody AiItemJobCreateRequest request) {
        return aiItemJobService.createJob(principal.id(), request);
    }

    /** GET /shop/ai-items/{jobId} — 본인 작업만 조회 가능. */
    @GetMapping("/ai-items/{jobId}")
    public AiItemJobStatusResponse getAiItemJob(@AuthenticationPrincipal MemberPrincipal principal,
                                                @PathVariable Long jobId) {
        return aiItemJobService.getJob(principal.id(), jobId);
    }

    /** POST /shop/ai-items/{jobId}/save — 생성 결과를 확인한 뒤 저장을 확정해 인벤토리에 지급받는다. */
    @PostMapping("/ai-items/{jobId}/save")
    public AiItemSaveResponse saveAiItem(@AuthenticationPrincipal MemberPrincipal principal,
                                         @PathVariable Long jobId) {
        return aiItemJobService.save(principal.id(), jobId);
    }
}
