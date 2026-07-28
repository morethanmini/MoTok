package ssafy.a706.backend.invitation;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.friend.model.Friendship;
import ssafy.a706.backend.friend.model.FriendshipStatus;
import ssafy.a706.backend.friend.repository.FriendshipRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.invitation.controller.dto.InvitationItemResponse;
import ssafy.a706.backend.invitation.model.Invitation;
import ssafy.a706.backend.invitation.repository.InvitationRepository;
import ssafy.a706.backend.invitation.service.InvitationService;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomDetailResponse;
import ssafy.a706.backend.liveroom.service.LiveRoomService;
import ssafy.a706.backend.global.notification.UserNotifier;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 대기실 친구 초대 규칙 (-100).
 *
 * <p>여기서 지키려는 건 "초대는 아무나 아무에게나 보낼 수 없다"는 세 겹의 조건이다 —
 * 친구여야 하고, 내가 그 방에 있어야 하고, 방이 대기 중이어야 한다. 하나라도 빠지면
 * 이 API가 모르는 사람 화면에 방 링크를 꽂는 통로가 된다.</p>
 */
class InvitationServiceTest {

    private static final long ME = 1L;
    private static final long FRIEND = 2L;
    private static final String ROOM_ID = "AB12CD";
    private static final String INVITE_CODE = "ZZ99YY";

    private final InvitationRepository invitationRepository = mock(InvitationRepository.class);
    private final FriendshipRepository friendshipRepository = mock(FriendshipRepository.class);
    private final LiveRoomService liveRoomService = mock(LiveRoomService.class);
    private final UserNotifier userNotifier = mock(UserNotifier.class);
    private final InvitationService service =
            new InvitationService(invitationRepository, friendshipRepository, liveRoomService, userNotifier);

    private final MemberPrincipal me = new MemberPrincipal(ME, "나");

    private static LiveRoomDetailResponse room(String status, LiveRoomDetailResponse.MemberView... members) {
        return new LiveRoomDetailResponse(ROOM_ID, "같이해요", "PUBLIC", 6, members.length,
                status, String.valueOf(ME), INVITE_CODE, List.of(members));
    }

    private static LiveRoomDetailResponse.MemberView member(long userId) {
        return new LiveRoomDetailResponse.MemberView(String.valueOf(userId), "u" + userId, false);
    }

    private void givenFriends() {
        given(friendshipRepository.findAllBetween(ME, FRIEND))
                .willReturn(List.of(accepted()));
    }

    private static Friendship accepted() {
        Friendship f = Friendship.request(ME, FRIEND);
        f.accept();
        return f;
    }

    @Test
    @DisplayName("대기 중인 방에 있는 참가자는 친구를 초대할 수 있다")
    void invitesFriendIntoWaitingRoom() {
        givenFriends();
        given(liveRoomService.get(ROOM_ID)).willReturn(room("WAITING", member(ME)));
        given(invitationRepository.findAllReceived(FRIEND)).willReturn(List.of());

        service.invite(me, ROOM_ID, FRIEND);

        var saved = forClass(Invitation.class);
        verify(invitationRepository).save(saved.capture());
        assertThat(saved.getValue().roomId()).isEqualTo(ROOM_ID);
        assertThat(saved.getValue().toUserId()).isEqualTo(FRIEND);
        assertThat(saved.getValue().fromNickname()).isEqualTo("나");
        // 수락한 쪽이 비밀번호 없이 들어갈 수 있도록 초대코드를 함께 싣는다
        assertThat(saved.getValue().inviteCode()).isEqualTo(INVITE_CODE);
    }

    @Test
    @DisplayName("친구가 아니면 초대할 수 없다 — 모르는 사람에게 방 링크를 꽂는 통로가 되지 않게")
    void rejectsNonFriend() {
        given(friendshipRepository.findAllBetween(ME, FRIEND)).willReturn(List.of());

        assertThatThrownBy(() -> service.invite(me, ROOM_ID, FRIEND))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.FRIEND_NOT_FOUND);
        verify(invitationRepository, never()).save(any());
    }

    @Test
    @DisplayName("PENDING 관계만 있으면 아직 친구가 아니라 초대할 수 없다")
    void rejectsPendingFriendship() {
        given(friendshipRepository.findAllBetween(ME, FRIEND))
                .willReturn(List.of(Friendship.request(ME, FRIEND)));

        assertThatThrownBy(() -> service.invite(me, ROOM_ID, FRIEND))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.FRIEND_NOT_FOUND);
    }

    @Test
    @DisplayName("그 방에 없는 사람은 초대할 수 없다 — 방장 전용은 아니지만 참가자여야 한다")
    void rejectsNonMember() {
        givenFriends();
        given(liveRoomService.get(ROOM_ID)).willReturn(room("WAITING", member(99L)));

        assertThatThrownBy(() -> service.invite(me, ROOM_ID, FRIEND))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.ROOM_INVITE_FORBIDDEN);
        verify(invitationRepository, never()).save(any());
    }

    @Test
    @DisplayName("게임이 시작된 방은 초대할 수 없다 — 어차피 입장이 막힌다")
    void rejectsPlayingRoom() {
        givenFriends();
        given(liveRoomService.get(ROOM_ID)).willReturn(room("PLAYING", member(ME)));

        assertThatThrownBy(() -> service.invite(me, ROOM_ID, FRIEND))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.ROOM_GAME_IN_PROGRESS);
    }

    @Test
    @DisplayName("같은 방으로 이미 보낸 초대가 살아 있으면 막는다 — 연타로 상대 화면을 도배하지 못하게")
    void rejectsDuplicateInvitation() {
        givenFriends();
        given(liveRoomService.get(ROOM_ID)).willReturn(room("WAITING", member(ME)));
        given(invitationRepository.findAllReceived(FRIEND))
                .willReturn(List.of(invitation("dup", ROOM_ID, Instant.now())));

        assertThatThrownBy(() -> service.invite(me, ROOM_ID, FRIEND))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVITATION_DUPLICATE);
        verify(invitationRepository, never()).save(any());
    }

    @Test
    @DisplayName("다른 방으로 온 초대가 있어도 새 방 초대는 보낼 수 있다")
    void allowsInvitationToDifferentRoom() {
        givenFriends();
        given(liveRoomService.get(ROOM_ID)).willReturn(room("WAITING", member(ME)));
        given(invitationRepository.findAllReceived(FRIEND))
                .willReturn(List.of(invitation("other", "ZZ00ZZ", Instant.now())));

        service.invite(me, ROOM_ID, FRIEND);

        verify(invitationRepository).save(any());
    }

    @Test
    @DisplayName("받은 초대는 최신순으로 내려간다")
    void listsReceivedNewestFirst() {
        Instant now = Instant.now();
        given(invitationRepository.findAllReceived(ME)).willReturn(List.of(
                invitation("old", "R1", now.minusSeconds(60)),
                invitation("new", "R2", now)));

        List<InvitationItemResponse> items = service.listReceived(ME);

        assertThat(items).extracting(InvitationItemResponse::invitationId)
                .containsExactly("new", "old");
        assertThat(items.get(0).expiresAt()).isEqualTo(now.plus(Invitation.TTL));
    }

    @Test
    @DisplayName("남의 초대는 404 — 존재 여부조차 흘리지 않는다")
    void dismissRejectsSomeoneElsesInvitation() {
        given(invitationRepository.find("x"))
                .willReturn(Optional.of(invitation("x", ROOM_ID, Instant.now()))); // toUserId=FRIEND

        assertThatThrownBy(() -> service.dismiss(ME, "x"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVITATION_NOT_FOUND);
        verify(invitationRepository, never()).delete(any());
    }

    @Test
    @DisplayName("만료돼 사라진 초대를 치우려 하면 404")
    void dismissRejectsExpiredInvitation() {
        given(invitationRepository.find("gone")).willReturn(Optional.empty());

        assertThatThrownBy(() -> service.dismiss(FRIEND, "gone"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVITATION_NOT_FOUND);
    }

    @Test
    @DisplayName("내가 받은 초대는 치울 수 있다")
    void dismissesOwnInvitation() {
        Invitation mine = invitation("mine", ROOM_ID, Instant.now());
        given(invitationRepository.find("mine")).willReturn(Optional.of(mine));

        service.dismiss(FRIEND, "mine");

        verify(invitationRepository).delete(mine);
    }

    private static Invitation invitation(String id, String roomId, Instant createdAt) {
        return new Invitation(id, roomId, "같이해요", INVITE_CODE, FRIEND, "나", createdAt);
    }
}
