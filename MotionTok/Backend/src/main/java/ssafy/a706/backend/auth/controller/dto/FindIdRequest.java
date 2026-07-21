package ssafy.a706.backend.auth.controller.dto;

import jakarta.validation.constraints.NotBlank;

/** API 명세서 FindIdRequest 스키마 — 가입 시 닉네임으로 이메일을 찾는다. */
public record FindIdRequest(
        @NotBlank String nickname
) {
}
