package ssafy.a706.backend.shop.controller.dto;

/** POST /internal/ai-jobs/{jobId}/complete 응답. Item은 아직 만들어지지 않는다(저장은 별도 API). */
public record InternalAiJobCompleteResponse(Long jobId, String imageUrl) {
}
