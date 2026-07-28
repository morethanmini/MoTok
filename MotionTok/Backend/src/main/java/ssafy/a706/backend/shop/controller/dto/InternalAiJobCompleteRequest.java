package ssafy.a706.backend.shop.controller.dto;

import jakarta.validation.constraints.NotBlank;

/** POST /internal/ai-jobs/{jobId}/complete 요청. */
public record InternalAiJobCompleteRequest(@NotBlank String imageBase64) {
}
