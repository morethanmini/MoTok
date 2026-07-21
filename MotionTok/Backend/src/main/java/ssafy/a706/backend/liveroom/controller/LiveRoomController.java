package ssafy.a706.backend.liveroom.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.liveroom.service.LiveRoomService;
import ssafy.a706.backend.liveroom.controller.dto.CreateLiveRoomRequest;
import ssafy.a706.backend.liveroom.controller.dto.CreateLiveRoomResponse;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomDetailResponse;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomSummaryResponse;

import java.util.List;

/**
 * S15P11A706-24: 방 생성(공개방·비밀방, 인원 설정). Redis 기반 방 저장소를 사용한다.
 * 기존 {@code /api/v1/rooms}(임대연, 인메모리 스텁)와 경로가 겹치지 않도록 별도 리소스로 분리했다.
 */
@RestController
@RequestMapping("/api/v1/live-rooms")
@RequiredArgsConstructor
public class LiveRoomController {

    private final LiveRoomService liveRoomService;

    @PostMapping
    public ResponseEntity<ApiResponse<CreateLiveRoomResponse>> create(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody CreateLiveRoomRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok("방 생성 완료", liveRoomService.create(principal, req)));
    }

    @GetMapping
    public ApiResponse<List<LiveRoomSummaryResponse>> list() {
        return ApiResponse.ok(liveRoomService.listPublic());
    }

    @GetMapping("/{roomId}")
    public ApiResponse<LiveRoomDetailResponse> get(@PathVariable String roomId) {
        return ApiResponse.ok(liveRoomService.get(roomId));
    }
}
