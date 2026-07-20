package ssafy.a706.backend.liveroom.controller.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.liveroom.model.LiveRoomVisibility;

/** 비공개방(PRIVATE)은 password가 6자리 숫자로 필수, 공개방(PUBLIC)은 password를 보내지 않는다(서비스 계층에서 검증). */
public record CreateLiveRoomRequest(
        @NotBlank @Size(max = 30) String title,
        @NotNull LiveRoomVisibility visibility,
        @Min(2) @Max(8) int maxPlayers,
        @Pattern(regexp = "\\d{6}", message = "비밀번호는 숫자 6자리여야 합니다.") String password
) {
}
