package ssafy.a706.backend.auth.controller.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.auth.validation.Password;
import ssafy.a706.backend.global.validation.NoProfanity;

/**
 * API 명세서 SignupRequest 스키마 (v0.2.1).
 * verificationToken은 POST /auth/email/verify 응답값이며 서버가 1회 소비한다.
 */
public record SignupRequest(
        @NotBlank @Email String email,
        @Password String password,
        @NotBlank @Size(min = 2, max = 16) @NoProfanity String nickname,
        @NotBlank String verificationToken
) {
}
