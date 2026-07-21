package ssafy.a706.backend.auth.controller.dto;

import jakarta.validation.constraints.NotBlank;
import ssafy.a706.backend.auth.validation.Password;

/**
 * API 명세서 PasswordResetConfirm 스키마.
 * newPassword는 명세상 가입과 같은 password 타입이라 동일 규칙(@Password: 12~64자·3종 조합)을 적용한다.
 */
public record PasswordResetConfirm(
        @NotBlank String token,
        @Password String newPassword
) {
}
