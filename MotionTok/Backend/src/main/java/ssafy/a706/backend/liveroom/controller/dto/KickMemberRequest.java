package ssafy.a706.backend.liveroom.controller.dto;

import jakarta.validation.constraints.NotNull;
import ssafy.a706.backend.liveroom.model.KickReason;

/** 방장이 참가자를 강퇴할 때 사용(S15P11A706-73). */
public record KickMemberRequest(
        @NotNull(message = "강퇴 사유는 필수입니다.") KickReason reason
) {
}
