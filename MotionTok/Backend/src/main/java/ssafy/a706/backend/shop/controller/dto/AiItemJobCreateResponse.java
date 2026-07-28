package ssafy.a706.backend.shop.controller.dto;

import ssafy.a706.backend.shop.model.AiJobStatus;

/** POST /shop/ai-items 응답. */
public record AiItemJobCreateResponse(Long jobId, AiJobStatus status) {
}
