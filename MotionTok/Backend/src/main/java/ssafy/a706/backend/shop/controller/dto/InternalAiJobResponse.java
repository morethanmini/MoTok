package ssafy.a706.backend.shop.controller.dto;

import ssafy.a706.backend.shop.model.ItemCategory;

/** GET /internal/ai-jobs/next 응답 — 워커가 생성에 필요한 최소 정보만 내려준다. */
public record InternalAiJobResponse(Long jobId, ItemCategory category, String sketchBase64) {
}
