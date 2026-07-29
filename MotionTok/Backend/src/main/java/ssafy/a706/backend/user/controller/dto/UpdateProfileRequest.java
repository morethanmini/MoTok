package ssafy.a706.backend.user.controller.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.global.validation.NoProfanity;

/** API 명세서 UpdateProfileRequest 스키마 — 닉네임 변경(중복 검사). 길이 규칙은 가입(2~16자)과 동일. */
public record UpdateProfileRequest(
        @NotBlank @Size(min = 2, max = 16) @NoProfanity String nickname
) {
}
