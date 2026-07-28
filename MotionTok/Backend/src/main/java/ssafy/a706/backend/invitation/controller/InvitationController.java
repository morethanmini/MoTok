package ssafy.a706.backend.invitation.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.invitation.controller.dto.CreateInvitationRequest;
import ssafy.a706.backend.invitation.controller.dto.InvitationItemResponse;
import ssafy.a706.backend.invitation.service.InvitationService;

import java.util.List;

/**
 * 방 초대(-100). 발송은 방에 매달린 하위 리소스라 {@code /v1/live-rooms/...} 아래에 있고,
 * 조회·삭제는 "내가 받은 것"이라 {@code /invitations}에 있다 — 경로 접두사가 갈려 클래스 레벨
 * {@code @RequestMapping} 없이 메서드마다 전체 경로를 적는다.
 *
 * <p>친구 도메인과 같은 이유로 성공 응답을 ApiResponse로 감싸지 않는다 — 프론트가 비래핑
 * 클라이언트로 호출한다. 게스트 차단은 SecurityConfig가 필터 단에서 처리한다(친구를 가질 수 없으므로).</p>
 */
@RestController
@RequiredArgsConstructor
public class InvitationController {

    private final InvitationService invitationService;

    /** POST /v1/live-rooms/{roomId}/invitations — 대기 중인 방으로 친구를 부른다. */
    @PostMapping("/api/v1/live-rooms/{roomId}/invitations")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void invite(@AuthenticationPrincipal MemberPrincipal principal,
                       @PathVariable String roomId,
                       @Valid @RequestBody CreateInvitationRequest req) {
        invitationService.invite(principal, roomId, req.friendId());
    }

    /** GET /invitations — 내가 받은, 아직 살아 있는 초대(로비가 폴링한다). */
    @GetMapping("/api/invitations")
    public List<InvitationItemResponse> received(@AuthenticationPrincipal MemberPrincipal principal) {
        return invitationService.listReceived(principal.id());
    }

    /** DELETE /invitations/{invitationId} — 거절했거나, 수락해 입장까지 마친 초대를 치운다. */
    @DeleteMapping("/api/invitations/{invitationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void dismiss(@AuthenticationPrincipal MemberPrincipal principal,
                        @PathVariable String invitationId) {
        invitationService.dismiss(principal.id(), invitationId);
    }
}
