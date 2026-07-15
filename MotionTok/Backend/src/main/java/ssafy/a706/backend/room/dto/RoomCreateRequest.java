package ssafy.a706.backend.room.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RoomCreateRequest(
        @NotBlank @Size(max = 30) String title,
        @Min(2) @Max(8) int maxPlayers,
        String gameCode
) {
}
