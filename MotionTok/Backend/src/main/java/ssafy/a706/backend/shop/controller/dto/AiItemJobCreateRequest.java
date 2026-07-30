package ssafy.a706.backend.shop.controller.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.shop.model.ItemCategory;

/**
 * POST /shop/ai-items 요청. sketchBase64 디코딩 크기(5MB 초과) 검증은 서비스에서 한다.
 * parentJobId가 없으면 새 결제 건(1,500P 차감), 있으면 그 job의 재생성(차감 없음, 최대 1회).
 */
public record AiItemJobCreateRequest(
        @NotBlank @Size(max = 20) String name,
        @NotNull ItemCategory category,
        @NotBlank String sketchBase64,
        Long parentJobId
) {
}
