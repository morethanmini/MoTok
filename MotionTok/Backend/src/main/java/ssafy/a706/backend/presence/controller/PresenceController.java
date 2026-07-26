package ssafy.a706.backend.presence.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.presence.controller.dto.HeartbeatRequest;
import ssafy.a706.backend.presence.controller.dto.HeartbeatResponse;
import ssafy.a706.backend.presence.service.PresenceService;

/**
 * 접속 상태 하트비트. 명세 §6 친구 목록의 presence를 채우는 원천이다(명세 확장 — 키맵 ⑥ presence:{userId}).
 *
 * <p>게스트는 대상이 아니다 — RDB에 영속되지 않아(D5) 친구 관계를 가질 수 없고, 따라서 남에게
 * 접속 상태를 보여줄 이유가 없다. SecurityConfig(/api/presence/** hasRole("USER"))가 필터 단에서 끊는다.</p>
 */
@RestController
@RequestMapping("/api/presence")
@RequiredArgsConstructor
public class PresenceController {

    private final PresenceService presenceService;

    /**
     * POST /presence/heartbeat — 살아 있음을 알리고 현재 방을 갱신한다.
     * 본문은 선택이다(방 밖에서는 보낼 값이 없어 빈 요청이 자연스럽다).
     */
    @PostMapping("/heartbeat")
    public HeartbeatResponse heartbeat(@AuthenticationPrincipal MemberPrincipal principal,
                                      @RequestBody(required = false) HeartbeatRequest req) {
        String roomId = req == null ? null : req.roomId();
        return new HeartbeatResponse(presenceService.heartbeat(principal.id(), roomId));
    }
}
