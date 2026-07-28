package ssafy.a706.backend.decor.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.decor.controller.dto.DecorationResponse;
import ssafy.a706.backend.decor.controller.dto.InventoryItemResponse;
import ssafy.a706.backend.decor.controller.dto.SaveDecorationRequest;
import ssafy.a706.backend.decor.controller.dto.UpdateEquippedRequest;
import ssafy.a706.backend.decor.service.DecorService;

import java.util.List;

/**
 * API 명세서 회원 도메인 중 인벤토리·화면 꾸미기.
 * 게스트 차단은 SecurityConfig(/api/users/** hasRole("USER"))가 필터 단에서 처리한다.
 */
@RestController
@RequestMapping("/api/users/me")
@RequiredArgsConstructor
public class DecorController {

    private final DecorService decorService;

    /** GET /users/me/inventory — 보유 아이템 목록(장착 여부 포함). */
    @GetMapping("/inventory")
    public List<InventoryItemResponse> inventory(@AuthenticationPrincipal MemberPrincipal principal) {
        return decorService.listInventory(principal.id());
    }

    /** PATCH /users/me/inventory/{itemId} — 장착/해제. */
    @PatchMapping("/inventory/{itemId}")
    public InventoryItemResponse setEquipped(@AuthenticationPrincipal MemberPrincipal principal,
                                            @PathVariable Long itemId,
                                            @Valid @RequestBody UpdateEquippedRequest request) {
        return decorService.setEquipped(principal.id(), itemId, request.equipped());
    }

    /** GET /users/me/decoration — 장착 아이템 배치. */
    @GetMapping("/decoration")
    public DecorationResponse decoration(@AuthenticationPrincipal MemberPrincipal principal) {
        return decorService.getDecoration(principal.id());
    }

    /** PUT /users/me/decoration — 배치 저장(전체 교체). */
    @PutMapping("/decoration")
    public DecorationResponse saveDecoration(@AuthenticationPrincipal MemberPrincipal principal,
                                             @Valid @RequestBody SaveDecorationRequest request) {
        return decorService.saveDecoration(principal.id(), request.config());
    }
}
