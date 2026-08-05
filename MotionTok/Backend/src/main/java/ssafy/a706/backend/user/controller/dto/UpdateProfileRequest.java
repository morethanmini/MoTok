package ssafy.a706.backend.user.controller.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.global.validation.NicknameFormat;
import ssafy.a706.backend.global.validation.NoProfanity;

/**
 * API 명세서 UpdateProfileRequest 스키마 — 닉네임 변경(중복 검사). 길이·문자 규칙은 가입과 동일.
 * 소셜 최초 로그인의 닉네임 설정도 이 경로를 지난다(nicknamePending 해제 = User.changeNickname).
 */
public record UpdateProfileRequest(
        @NotBlank @Size(min = 2, max = 16) @NicknameFormat @NoProfanity String nickname
) {
}
