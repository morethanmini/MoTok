package ssafy.a706.backend.user.dto;

import jakarta.validation.constraints.Size;

/**
 * 프로필 수정(닉네임/비밀번호). null 필드는 변경하지 않음.
 */
public record UserUpdateRequest(
        @Size(min = 2, max = 16) String nickname,
        @Size(min = 8, max = 64) String password
) {
}
