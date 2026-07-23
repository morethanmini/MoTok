package ssafy.a706.backend.video;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.video.dto.SfuTokenResponse;

/**
 * SFU(LiveKit) 접속 토큰 발급. 인증 필수(익명 발급 허용 시 미디어서버가 무료 중계기가 됨).
 * 경로는 방 리소스 하위지만 파일은 liveroom과 분리 — 방 도메인 코드 수정 없이 얹는다.
 */
@RestController
@RequiredArgsConstructor
public class SfuTokenController {

    private final SfuTokenService sfuTokenService;

    @GetMapping("/api/v1/live-rooms/{roomId}/video-token")
    public ApiResponse<SfuTokenResponse> issueVideoToken(@PathVariable String roomId,
                                                         @AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(sfuTokenService.issue(roomId, principal));
    }
}
