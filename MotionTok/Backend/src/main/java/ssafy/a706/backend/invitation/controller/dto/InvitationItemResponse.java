package ssafy.a706.backend.invitation.controller.dto;

import ssafy.a706.backend.invitation.model.Invitation;

import java.time.Instant;

/**
 * API 명세 InvitationItem — 로비가 폴링으로 가져가는 "받은 초대" 한 건.
 *
 * <p>expiresAt을 함께 내려 클라이언트가 카드를 스스로 걷어낼 수 있게 한다. 폴링 주기(12초) 안에서는
 * 이미 만료된 초대를 잠깐 보게 되는데, 그 사이 수락을 누르면 404가 나므로 화면에서 먼저 지우는 편이 낫다.</p>
 */
public record InvitationItemResponse(
        String invitationId,
        String roomId,
        String roomTitle,
        String inviteCode,
        String fromNickname,
        Instant createdAt,
        Instant expiresAt
) {

    public static InvitationItemResponse from(Invitation invitation) {
        return new InvitationItemResponse(
                invitation.invitationId(),
                invitation.roomId(),
                invitation.roomTitle(),
                invitation.inviteCode(),
                invitation.fromNickname(),
                invitation.createdAt(),
                invitation.expiresAt()
        );
    }
}
