package ssafy.a706.backend.liveroom.controller.dto;

import java.util.List;

public record LiveRoomListResponse(
        List<LiveRoomSummaryResponse> rooms,
        boolean hasNext
) {
}
