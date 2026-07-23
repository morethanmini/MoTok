package ssafy.a706.backend.video;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.video.dto.VideoAccessResponse;

/**
 * 통합 화상 접속 API(-123). 클라이언트는 이 하나만 호출하고 응답 mode로 분기한다.
 * 인증 필수(익명 발급 허용 시 미디어서버·릴레이가 무료 중계기가 됨).
 * 기존 video-token(-30)·ice-servers(-31) 엔드포인트는 프론트 이행 전까지 병행 유지.
 */
@RestController
@RequiredArgsConstructor
public class VideoAccessController {

    private final VideoAccessService videoAccessService;

    @GetMapping("/api/v1/live-rooms/{roomId}/rtc-access")
    public ApiResponse<VideoAccessResponse> issueRtcAccess(@PathVariable String roomId,
                                                           @AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(videoAccessService.issue(roomId, principal));
    }
}
