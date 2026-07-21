package ssafy.a706.backend.auth.controller.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/** API 명세서 PasswordResetRequest 스키마 — 재설정 링크를 받을 가입 이메일. */
public record PasswordResetRequest(
        @NotBlank @Email String email
) {
}
