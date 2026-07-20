package ssafy.a706.backend.liveroom.controller.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.liveroom.model.LiveRoomVisibility;

public record CreateLiveRoomRequest(
        @NotBlank @Size(max = 30) String title,
        @NotNull LiveRoomVisibility visibility,
        @Min(2) @Max(8) int maxPlayers
) {
}
