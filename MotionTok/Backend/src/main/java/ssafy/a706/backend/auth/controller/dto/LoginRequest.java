package ssafy.a706.backend.auth.controller.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * API 명세서 LoginRequest 스키마.
 * rememberMe는 선택 필드다. Jackson 3는 FAIL_ON_NULL_FOR_PRIMITIVES가 기본 true이므로
 * primitive boolean으로 두면 이 필드를 생략한 요청이 400이 된다 — 반드시 래퍼 타입이어야 한다.
 */
public record LoginRequest(
        @NotBlank @Email String email,
        @NotBlank String password,
        Boolean rememberMe
) {
}
