package ssafy.a706.backend.auth.controller.dto;

import jakarta.validation.constraints.NotBlank;

/** API 명세서 RefreshRequest 스키마. */
public record RefreshRequest(@NotBlank String refreshToken) {
}
