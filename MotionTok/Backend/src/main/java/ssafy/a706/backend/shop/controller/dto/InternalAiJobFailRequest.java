package ssafy.a706.backend.shop.controller.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** POST /internal/ai-jobs/{jobId}/fail 요청. */
public record InternalAiJobFailRequest(@NotBlank @Size(max = 500) String message) {
}
