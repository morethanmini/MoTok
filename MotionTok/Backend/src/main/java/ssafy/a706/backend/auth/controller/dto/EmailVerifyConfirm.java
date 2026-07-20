package ssafy.a706.backend.auth.controller.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** API 명세서 EmailVerifyConfirm 스키마 (v0.2.1). */
public record EmailVerifyConfirm(
        @NotBlank @Email String email,
        @NotBlank @Pattern(regexp = "\\d{6}", message = "인증번호는 6자리 숫자입니다.") String code
) {
}
