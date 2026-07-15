package ssafy.a706.backend.room;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.room.dto.RoomCreateRequest;
import ssafy.a706.backend.room.dto.RoomResponse;
import ssafy.a706.backend.room.dto.RoomSummaryResponse;

import java.util.List;

@RestController
@RequestMapping("/api/v1/rooms")
@RequiredArgsConstructor
public class RoomController {

    private final RoomService roomService;

    /** 공개 방 목록(대기 중). 게스트 로그인 전에도 브라우징 가능하도록 공개. */
    @GetMapping
    public ApiResponse<List<RoomSummaryResponse>> list() {
        return ApiResponse.ok(roomService.listWaiting());
    }

    @PostMapping
    public ResponseEntity<ApiResponse<RoomResponse>> create(@AuthenticationPrincipal AuthPrincipal principal,
                                                            @Valid @RequestBody RoomCreateRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok("방 생성 완료", roomService.create(principal, req)));
    }

    @GetMapping("/{roomId}")
    public ApiResponse<RoomResponse> get(@PathVariable String roomId) {
        return ApiResponse.ok(roomService.get(roomId));
    }

    @PostMapping("/{roomId}/join")
    public ApiResponse<RoomResponse> join(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable String roomId) {
        return ApiResponse.ok("입장", roomService.join(principal, roomId));
    }

    @PostMapping("/quick-start")
    public ResponseEntity<ApiResponse<RoomResponse>> quickStart(@AuthenticationPrincipal AuthPrincipal principal) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok("빠른 시작", roomService.quickStart(principal)));
    }
}
