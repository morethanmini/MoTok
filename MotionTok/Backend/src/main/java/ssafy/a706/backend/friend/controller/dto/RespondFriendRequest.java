package ssafy.a706.backend.friend.controller.dto;

import jakarta.validation.constraints.NotNull;
import ssafy.a706.backend.friend.model.RequestAction;

/** API 명세 §6 RespondFriendRequest — 받은 요청을 수락/거절한다. */
public record RespondFriendRequest(
        @NotNull RequestAction action
) {
}
