package ssafy.a706.backend.invitation.controller.dto;

import jakarta.validation.constraints.NotNull;

/**
 * API 명세 CreateInvitationRequest — 친구 목록에서 고른 상대를 userId로 지목한다.
 * 친구 요청(닉네임 검색)과 달리 이미 친구 목록에서 고른 대상이라 id를 그대로 쓴다.
 */
public record CreateInvitationRequest(
        @NotNull Long friendId
) {
}
