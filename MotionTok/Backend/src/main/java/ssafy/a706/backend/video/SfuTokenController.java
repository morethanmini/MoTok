package ssafy.a706.backend.video;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.video.dto.SfuTokenResponse;
import ssafy.a706.backend.video.dto.VideoAccessResponse;

/**
 * [레거시 -30] SFU(LiveKit) 접속 토큰 발급. 프론트(api/modules/sfu.ts)가 사용 중인 계약이라
 * 경로·응답 스키마를 동결하고, 발급은 어댑터 계층에 위임한다.
 * rtc.provider 설정과 무관하게 항상 LiveKit 고정 — 전역 스위치가 기존 화면을 깨지 않게.
 */
@RestController
@RequiredArgsConstructor
public class SfuTokenController {

    private final VideoAccessService videoAccessService;

    @GetMapping("/api/v1/live-rooms/{roomId}/video-token")
    public ApiResponse<SfuTokenResponse> issueVideoToken(@PathVariable String roomId,
                                                         @AuthenticationPrincipal AuthPrincipal principal) {
        VideoAccessResponse.SfuAccess sfu =
                videoAccessService.issue(roomId, principal, VideoAccessMode.SFU_LIVEKIT).sfu();
        return ApiResponse.ok(new SfuTokenResponse(sfu.url(), sfu.token(), sfu.expiresIn()));
    }
}
