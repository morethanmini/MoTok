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
import ssafy.a706.backend.liveroom.controller.dto.JoinLiveRoomByInviteCodeRequest;
import ssafy.a706.backend.liveroom.controller.dto.JoinLiveRoomRequest;
import ssafy.a706.backend.liveroom.controller.dto.KickMemberRequest;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomDetailResponse;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomListResponse;

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
    public ApiResponse<LiveRoomListResponse> list(@RequestParam(defaultValue = "1") int page) {
        return ApiResponse.ok(liveRoomService.list(page));
    }

    @GetMapping("/{roomId}")
    public ApiResponse<LiveRoomDetailResponse> get(@PathVariable String roomId) {
        return ApiResponse.ok(liveRoomService.get(roomId));
    }

    @PostMapping("/{roomId}/join")
    public ApiResponse<LiveRoomDetailResponse> join(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String roomId,
            @Valid @RequestBody JoinLiveRoomRequest req) {
        return ApiResponse.ok(liveRoomService.join(principal, roomId, req));
    }

    @PostMapping("/join-by-invite-code")
    public ApiResponse<LiveRoomDetailResponse> joinByInviteCode(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody JoinLiveRoomByInviteCodeRequest req) {
        return ApiResponse.ok(liveRoomService.joinByInviteCode(principal, req));
    }

    @PostMapping("/quick-start")
    public ApiResponse<LiveRoomDetailResponse> quickStart(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(liveRoomService.quickStart(principal));
    }

    @DeleteMapping("/{roomId}/members/me")
    public ApiResponse<Void> leave(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String roomId) {
        liveRoomService.leave(principal, roomId);
        return ApiResponse.ok("방 나가기 완료");
    }

    @PostMapping("/{roomId}/members/{userId}/kick")
    public ApiResponse<Void> kick(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String roomId,
            @PathVariable String userId,
            @Valid @RequestBody KickMemberRequest req) {
        liveRoomService.kick(principal, roomId, userId, req.reason());
        return ApiResponse.ok("강퇴 완료");
    }
}
