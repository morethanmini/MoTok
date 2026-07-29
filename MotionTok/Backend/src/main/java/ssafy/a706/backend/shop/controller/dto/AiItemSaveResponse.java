package ssafy.a706.backend.shop.controller.dto;

/** POST /shop/ai-items/{jobId}/save 응답. */
public record AiItemSaveResponse(Long itemId, String imageUrl) {
}
