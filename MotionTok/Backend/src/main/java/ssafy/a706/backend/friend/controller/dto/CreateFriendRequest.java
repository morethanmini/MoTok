package ssafy.a706.backend.friend.controller.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * API 명세 §6 CreateFriendRequest — 닉네임으로 상대를 찾아 요청한다(userId 노출 없이).
 * 길이 상한은 users.nickname 컬럼(32)과 맞춘다.
 */
public record CreateFriendRequest(
        @NotBlank @Size(max = 32) String targetNickname
) {
}
