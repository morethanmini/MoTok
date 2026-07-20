package ssafy.a706.backend.liveroom.controller.dto;

import jakarta.validation.constraints.NotBlank;

/** 기존 초대코드 복사 입장 기능(그대로 유지) — 초대코드는 비밀번호 검증 없이 입장을 허용한다. */
public record JoinLiveRoomByInviteCodeRequest(
        @NotBlank String inviteCode
) {
}
