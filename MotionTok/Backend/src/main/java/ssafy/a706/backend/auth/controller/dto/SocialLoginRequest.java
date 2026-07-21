package ssafy.a706.backend.auth.controller.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * API 명세서 SocialLoginRequest 스키마.
 * authorizationCode: OAuth 인가 코드(권장 흐름). redirectUri: 프론트 리다이렉트 URI —
 * 명세상 선택이지만 인가 코드 교환 시 provider가 요구하므로 인가 코드 흐름에서는 함께 보내야 한다.
 */
public record SocialLoginRequest(
        @NotBlank String authorizationCode,
        String redirectUri
) {
}
