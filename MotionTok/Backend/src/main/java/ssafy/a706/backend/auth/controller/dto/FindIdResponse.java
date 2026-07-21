package ssafy.a706.backend.auth.controller.dto;

/** API 명세서 FindIdResponse 스키마 — 일부 마스킹된 이메일. */
public record FindIdResponse(
        String maskedEmail
) {
}
