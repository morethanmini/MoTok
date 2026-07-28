package ssafy.a706.backend.shop.controller.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.shop.model.ItemCategory;

/** POST /shop/ai-items 요청. sketchBase64 디코딩 크기(5MB 초과) 검증은 서비스에서 한다. */
public record AiItemJobCreateRequest(
        @NotBlank @Size(max = 20) String name,
        @NotNull ItemCategory category,
        @NotBlank String sketchBase64
) {
}
