package ssafy.a706.backend.user.controller.dto;

import jakarta.validation.constraints.NotBlank;
import ssafy.a706.backend.auth.validation.Password;

/** API 명세서 ChangePasswordRequest 스키마 — 현재 비밀번호 확인 후 변경. 새 비밀번호는 가입과 동일 규칙(@Password). */
public record ChangePasswordRequest(
        @NotBlank String currentPassword,
        @Password String newPassword
) {
}
