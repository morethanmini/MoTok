package ssafy.a706.backend.auth.controller.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/** API 명세서 EmailVerifyRequest 스키마 (v0.2.1). */
public record EmailVerifyRequest(@NotBlank @Email String email) {
}
