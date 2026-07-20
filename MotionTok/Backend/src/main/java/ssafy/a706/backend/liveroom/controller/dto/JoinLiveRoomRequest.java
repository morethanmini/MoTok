package ssafy.a706.backend.liveroom.controller.dto;

import jakarta.validation.constraints.Pattern;

/** 방 목록에서 roomId로 직접 입장할 때 사용. 비공개방(hasPassword=true)이면 password가 필요하다(서비스 계층에서 검증). */
public record JoinLiveRoomRequest(
        @Pattern(regexp = "\\d{6}", message = "비밀번호는 숫자 6자리여야 합니다.") String password
) {
}
