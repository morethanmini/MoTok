package ssafy.a706.backend.shop.controller.dto;

/** POST /internal/ai-jobs/{jobId}/complete 응답. */
public record InternalAiJobCompleteResponse(Long itemId, String imageUrl) {
}
