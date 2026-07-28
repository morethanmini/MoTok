package ssafy.a706.backend.invitation.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.friend.model.FriendshipStatus;
import ssafy.a706.backend.friend.repository.FriendshipRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.notification.UserNotification;
import ssafy.a706.backend.global.notification.UserNotifier;
import ssafy.a706.backend.invitation.controller.dto.InvitationItemResponse;
import ssafy.a706.backend.invitation.model.Invitation;
import ssafy.a706.backend.invitation.repository.InvitationRepository;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomDetailResponse;
import ssafy.a706.backend.liveroom.service.LiveRoomService;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * 대기실 친구 초대(-100).
 *
 * <p><b>전달은 저장 + 푸시다.</b> 예전에는 STOMP가 게임룸에서만 연결되는데 초대를 받는 사람은 정의상
 * 게임룸 밖(로비)에 있어, 개인에게 푸시할 통로가 아예 없었다. 그래서 초대를 Redis에 남기고 로비가
 * 12초 주기로 가져가게 했고 알림은 최대 그만큼 늦게 떴다. 전역 STOMP 연결(-142)로 개인 알림 채널
 * ({@code /user/queue/notifications})이 살아나면서, 저장은 그대로 두고 푸시를 얹었다.
 * 저장을 남긴 이유는 푸시가 유실될 수 있어서다 — 상대가 재연결 중이면 그 프레임은 사라지므로,
 * 클라이언트는 연결이 성립할 때마다 {@code GET /invitations}로 놓친 것을 메운다.</p>
 *
 * <p>초대를 보낼 수 있는 조건은 셋이다 — <b>친구여야</b> 하고(아무 userId나 넣어 초대를 흩뿌리지
 * 못하게), <b>내가 그 방에 있어야</b> 하며(방장 전용은 아니다. 같이 있는 사람을 부르는 건 참가자 모두의
 * 권한이다), <b>방이 대기 중</b>이어야 한다(게임이 시작된 방은 어차피 입장이 막힌다).</p>
 */
@Service
@RequiredArgsConstructor
public class InvitationService {

    private static final String STATUS_WAITING = "WAITING";

    private final InvitationRepository invitationRepository;
    private final FriendshipRepository friendshipRepository;
    private final LiveRoomService liveRoomService;
    private final UserNotifier userNotifier;

    /** POST /v1/live-rooms/{roomId}/invitations — 대기 중인 내 방으로 친구를 부른다. */
    public void invite(MemberPrincipal inviter, String roomId, Long friendId) {
        if (!areFriends(inviter.id(), friendId)) {
            throw new BusinessException(ErrorCode.FRIEND_NOT_FOUND);
        }

        LiveRoomDetailResponse room = liveRoomService.get(roomId); // 없는 방이면 ROOM_NOT_FOUND
        boolean inviterIsMember = room.members().stream()
                .anyMatch(m -> !m.guest() && m.userId().equals(inviter.userId()));
        if (!inviterIsMember) {
            throw new BusinessException(ErrorCode.ROOM_INVITE_FORBIDDEN);
        }
        if (!STATUS_WAITING.equals(room.status())) {
            throw new BusinessException(ErrorCode.ROOM_GAME_IN_PROGRESS);
        }

        // 같은 방으로 이미 부른 초대가 살아 있으면 막는다 — 연타로 상대 화면을 도배하지 못하게.
        // 만료(5분)되면 다시 부를 수 있다.
        boolean alreadyInvited = invitationRepository.findAllReceived(friendId).stream()
                .anyMatch(i -> i.roomId().equals(roomId));
        if (alreadyInvited) {
            throw new BusinessException(ErrorCode.INVITATION_DUPLICATE);
        }

        Invitation invitation = new Invitation(
                UUID.randomUUID().toString(),
                room.roomId(),
                room.title(),
                room.inviteCode(),
                friendId,
                inviter.displayName(),
                Instant.now());
        invitationRepository.save(invitation);
        // 저장은 그대로 두고 푸시만 얹는다 — 접속 중이 아니면 푸시는 사라지지만 GET /invitations가 받쳐 준다.
        userNotifier.notify(friendId, UserNotification.roomInvitation(InvitationItemResponse.from(invitation)));
    }

    /** GET /invitations — 내가 받은, 아직 살아 있는 초대. 최신순. */
    public List<InvitationItemResponse> listReceived(Long userId) {
        return invitationRepository.findAllReceived(userId).stream()
                .sorted(Comparator.comparing(Invitation::createdAt).reversed())
                .map(InvitationItemResponse::from)
                .toList();
    }

    /**
     * DELETE /invitations/{invitationId} — 받은 초대를 치운다.
     *
     * <p>수락/거절을 action으로 구분하지 않는다. 거절은 곧 "치운다"이고, 수락은 초대에 실린
     * inviteCode로 {@code join-by-invite-code}를 호출한 <b>뒤에</b> 치우기 때문이다 —
     * 먼저 지우면 정원이 찼거나 게임이 시작돼 입장이 실패했을 때 다시 눌러 볼 초대가 사라진다.
     * 실제 입장 판정(정원·게임 시작·강퇴)은 그 엔드포인트가 그대로 한다.</p>
     *
     * <p>거절을 초대자에게 알리지는 않는다 — 개인 알림 채널이 없다(-100 범위 밖).</p>
     */
    public void dismiss(Long userId, String invitationId) {
        Invitation invitation = invitationRepository.find(invitationId)
                .filter(i -> i.toUserId().equals(userId)) // 남의 초대는 '없는 것'으로 — 존재 여부를 흘리지 않는다
                .orElseThrow(() -> new BusinessException(ErrorCode.INVITATION_NOT_FOUND));
        invitationRepository.delete(invitation);
    }

    private boolean areFriends(Long a, Long b) {
        return friendshipRepository.findAllBetween(a, b).stream()
                .anyMatch(f -> f.getStatus() == FriendshipStatus.ACCEPTED);
    }
}
