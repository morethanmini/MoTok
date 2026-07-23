package ssafy.a706.backend.rtc;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.rtc.dto.IceServersResponse;

/**
 * API 명세서 "실시간 인프라" — GET /rtc/ice-servers (-31).
 * 인증 필수: 익명 발급을 허용하면 릴레이 서버가 외부에 무료 프록시로 노출된다.
 */
@RestController
@RequestMapping("/api/v1/rtc")
@RequiredArgsConstructor
public class RtcController {

    private final IceServerService iceServerService;

    @GetMapping("/ice-servers")
    public ApiResponse<IceServersResponse> iceServers(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(iceServerService.issue(principal.userId()));
    }
}
