package ssafy.a706.backend.shop.controller.dto;

import ssafy.a706.backend.shop.model.AiJobStatus;

/** GET /shop/ai-items/{jobId} 응답. DONE 이전에는 itemId·imageUrl이 null, FAILED가 아니면 errorMessage가 null. */
public record AiItemJobStatusResponse(
        Long jobId,
        AiJobStatus status,
        Long itemId,
        String imageUrl,
        String errorMessage
) {
}
