package ssafy.a706.backend.presence.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.presence.controller.dto.AdminOnlineUserResponse;
import ssafy.a706.backend.presence.service.PresenceAdminService;

/**
 * 관리자 접속자 목록. 인가는 SecurityConfig가 {@code /api/v1/admin/**}로 일괄 처리한다.
 *
 * <p>하트비트는 STOMP({@link PresenceStompController})로 들어오지만 조회는 REST다 — 관리자가
 * 열어 볼 때만 필요한 화면에 구독을 붙이면, 접속자 수만큼의 이벤트가 관리자 화면으로 밀려온다.</p>
 */
@RestController
@RequestMapping("/api/v1/admin/online-users")
@RequiredArgsConstructor
public class PresenceAdminController {

    private final PresenceAdminService presenceAdminService;

    /**
     * GET /v1/admin/online-users — 지금 접속 중인 사람 전부(최대 500명).
     *
     * <p>페이지 파라미터가 없다. 목록의 수명이 60초(프레즌스 TTL)라 페이지를 넘기는 사이에
     * 앞 페이지가 이미 다른 사람들이 된다 — 끊어서 주면 오히려 일관되지 않은 화면이 된다.</p>
     */
    @GetMapping
    public ApiResponse<AdminOnlineUserResponse> onlineUsers() {
        return ApiResponse.ok(presenceAdminService.onlineUsers());
    }
}
