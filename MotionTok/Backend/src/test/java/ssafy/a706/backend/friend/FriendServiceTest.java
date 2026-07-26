package ssafy.a706.backend.friend;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.friend.controller.dto.CreateFriendRequest;
import ssafy.a706.backend.friend.controller.dto.FriendResponse;
import ssafy.a706.backend.friend.controller.dto.FriendRoomResponse;
import ssafy.a706.backend.friend.model.Friendship;
import ssafy.a706.backend.friend.model.FriendshipStatus;
import ssafy.a706.backend.friend.model.RequestAction;
import ssafy.a706.backend.friend.repository.FriendshipRepository;
import ssafy.a706.backend.friend.service.FriendService;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.presence.model.PresenceSnapshot;
import ssafy.a706.backend.presence.service.PresenceService;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyIterable;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 친구 요청·수락 규칙 (-57).
 *
 * <p>여기서 지키려는 핵심은 <b>A→B와 B→A가 동시에 PENDING일 수 있다</b>는 전제다. requester/addressee
 * 방향을 보존하는 대신(화면이 "누가 보냈는지"를 표시하므로) 양방향 중복이 가능해졌고, 수락 시 반대 방향을
 * 정리하지 않으면 상대 화면에 처리할 수 없는 요청이 영구히 남는다.</p>
 */
class FriendServiceTest {

    private static final long ME = 1L;
    private static final long OTHER = 2L;

    private final FriendshipRepository friendshipRepository = mock(FriendshipRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final PresenceService presenceService = mock(PresenceService.class);
    private final FriendService service =
            new FriendService(friendshipRepository, userRepository, presenceService);

    private static User user(long id, String nickname) {
        User u = User.builder().email(nickname + "@t.dev").nickname(nickname).build();
        ReflectionTestUtils.setField(u, "id", id);
        return u;
    }

    private static Friendship pending(long id, long requesterId, long addresseeId) {
        Friendship f = Friendship.request(requesterId, addresseeId);
        ReflectionTestUtils.setField(f, "id", id);
        ReflectionTestUtils.setField(f, "createdAt", LocalDateTime.now());
        return f;
    }

    private static Friendship accepted(long id, long requesterId, long addresseeId) {
        Friendship f = pending(id, requesterId, addresseeId);
        f.accept();
        return f;
    }

    @Test
    @DisplayName("수락하면 반대 방향으로 떠 있던 PENDING 요청도 함께 삭제된다")
    void acceptRemovesReversePendingRequest() {
        Friendship incoming = pending(10L, OTHER, ME);   // 상대 → 나 (내가 수락할 요청)
        Friendship outgoing = pending(11L, ME, OTHER);   // 나 → 상대 (내가 전에 보낸 요청)
        given(friendshipRepository.findById(10L)).willReturn(Optional.of(incoming));
        given(friendshipRepository.findByRequesterIdAndAddresseeId(ME, OTHER))
                .willReturn(Optional.of(outgoing));

        service.respond(ME, 10L, RequestAction.ACCEPT);

        assertThat(incoming.getStatus()).isEqualTo(FriendshipStatus.ACCEPTED);
        assertThat(incoming.getRespondedAt()).isNotNull();
        verify(friendshipRepository).delete(outgoing);
    }

    @Test
    @DisplayName("반대 방향 요청이 없으면 수락만 하고 아무것도 지우지 않는다")
    void acceptWithoutReverseRequestDeletesNothing() {
        Friendship incoming = pending(10L, OTHER, ME);
        given(friendshipRepository.findById(10L)).willReturn(Optional.of(incoming));
        given(friendshipRepository.findByRequesterIdAndAddresseeId(ME, OTHER))
                .willReturn(Optional.empty());

        service.respond(ME, 10L, RequestAction.ACCEPT);

        assertThat(incoming.getStatus()).isEqualTo(FriendshipStatus.ACCEPTED);
        verify(friendshipRepository, never()).delete(any());
    }

    @Test
    @DisplayName("거절은 상태를 바꾸지 않고 행을 삭제한다 — 그래야 나중에 다시 요청할 수 있다")
    void rejectDeletesRow() {
        Friendship incoming = pending(10L, OTHER, ME);
        given(friendshipRepository.findById(10L)).willReturn(Optional.of(incoming));

        service.respond(ME, 10L, RequestAction.REJECT);

        verify(friendshipRepository).delete(incoming);
        assertThat(incoming.getStatus()).isEqualTo(FriendshipStatus.PENDING);
    }

    @Test
    @DisplayName("받은 사람이 아니면 수락·거절할 수 없다 — 보낸 사람이 자기 요청을 수락하는 것도 막는다")
    void onlyAddresseeCanRespond() {
        Friendship outgoing = pending(11L, ME, OTHER);
        given(friendshipRepository.findById(11L)).willReturn(Optional.of(outgoing));

        assertThatThrownBy(() -> service.respond(ME, 11L, RequestAction.ACCEPT))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.FRIEND_REQUEST_FORBIDDEN);
    }

    @Test
    @DisplayName("보낸 요청 철회는 보낸 사람만 할 수 있다")
    void onlyRequesterCanCancel() {
        Friendship incoming = pending(10L, OTHER, ME);
        given(friendshipRepository.findById(10L)).willReturn(Optional.of(incoming));

        assertThatThrownBy(() -> service.cancel(ME, 10L))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.FRIEND_REQUEST_FORBIDDEN);
    }

    @Test
    @DisplayName("자신에게는 친구 요청을 보낼 수 없다")
    void cannotRequestSelf() {
        User me = user(ME, "나");
        given(userRepository.findById(ME)).willReturn(Optional.of(me));
        given(userRepository.findByNickname("나")).willReturn(Optional.of(me));

        assertThatThrownBy(() -> service.request(ME, new CreateFriendRequest("나")))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.FRIEND_SELF_REQUEST);
    }

    @Test
    @DisplayName("이미 친구면 409 — 방향과 무관하게 판단한다")
    void cannotRequestExistingFriend() {
        given(userRepository.findById(ME)).willReturn(Optional.of(user(ME, "나")));
        given(userRepository.findByNickname("친구")).willReturn(Optional.of(user(OTHER, "친구")));
        // 상대가 requester인 ACCEPTED 관계 — 내가 보낸 게 아니어도 이미 친구다
        given(friendshipRepository.findAllBetween(ME, OTHER))
                .willReturn(List.of(accepted(10L, OTHER, ME)));

        assertThatThrownBy(() -> service.request(ME, new CreateFriendRequest("친구")))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.FRIEND_ALREADY);
    }

    @Test
    @DisplayName("같은 방향 중복 요청은 UNIQUE 위반을 409로 바꿔 돌려준다")
    void duplicateRequestBecomesConflict() {
        given(userRepository.findById(ME)).willReturn(Optional.of(user(ME, "나")));
        given(userRepository.findByNickname("친구")).willReturn(Optional.of(user(OTHER, "친구")));
        given(friendshipRepository.findAllBetween(ME, OTHER)).willReturn(List.of());
        given(friendshipRepository.saveAndFlush(any()))
                .willThrow(new DataIntegrityViolationException("uk_friendship_requester_addressee"));

        assertThatThrownBy(() -> service.request(ME, new CreateFriendRequest("친구")))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.FRIEND_REQUEST_DUPLICATE);
    }

    @Test
    @DisplayName("탈퇴한 계정은 친구 목록에서 빠진다 — 관계 행은 지우지 않는다")
    void withdrawnFriendIsHiddenFromList() {
        User withdrawn = user(OTHER, "탈퇴자");
        ReflectionTestUtils.setField(withdrawn, "deletedAt", LocalDateTime.now());
        given(friendshipRepository.findAllByUserIdAndStatus(ME, FriendshipStatus.ACCEPTED))
                .willReturn(List.of(accepted(10L, ME, OTHER)));
        given(userRepository.findAllById(anyIterable())).willReturn(List.of(withdrawn));

        List<FriendResponse> friends = service.listFriends(ME);

        assertThat(friends).isEmpty();
        verify(friendshipRepository, never()).delete(any());
    }

    @Test
    @DisplayName("친구방 조회 — 친구가 방에 있으면 roomId를 돌려준다")
    void friendRoomReturnsRoomId() {
        given(friendshipRepository.findAllBetween(ME, OTHER))
                .willReturn(List.of(accepted(10L, ME, OTHER)));
        given(presenceService.find(OTHER)).willReturn(PresenceSnapshot.online("MP4X9K"));

        assertThat(service.findFriendRoom(ME, OTHER).roomId()).isEqualTo("MP4X9K");
    }

    @Test
    @DisplayName("친구방 조회 — 방에 없으면 404가 아니라 roomId=null인 200이다")
    void friendRoomIsNullWhenNotInRoom() {
        given(friendshipRepository.findAllBetween(ME, OTHER))
                .willReturn(List.of(accepted(10L, ME, OTHER)));
        // 접속해 있지만 로비에 있는 경우
        given(presenceService.find(OTHER)).willReturn(PresenceSnapshot.online(null));

        FriendRoomResponse res = service.findFriendRoom(ME, OTHER);

        assertThat(res.roomId()).isNull();
    }

    @Test
    @DisplayName("친구방 조회 — 친구가 아니면 404. 남의 위치를 알아내는 통로가 되면 안 된다")
    void friendRoomRejectsNonFriend() {
        given(friendshipRepository.findAllBetween(ME, OTHER)).willReturn(List.of());

        assertThatThrownBy(() -> service.findFriendRoom(ME, OTHER))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.FRIEND_NOT_FOUND);
    }

    @Test
    @DisplayName("친구방 조회 — PENDING 관계만 있으면 아직 친구가 아니라 404")
    void friendRoomRejectsPendingOnly() {
        given(friendshipRepository.findAllBetween(ME, OTHER))
                .willReturn(List.of(pending(10L, ME, OTHER)));

        assertThatThrownBy(() -> service.findFriendRoom(ME, OTHER))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.FRIEND_NOT_FOUND);
    }

    @Test
    @DisplayName("프레즌스에 없는 친구는 OFFLINE으로 내려간다 — 키 부재가 곧 오프라인")
    void missingPresenceMeansOffline() {
        given(friendshipRepository.findAllByUserIdAndStatus(ME, FriendshipStatus.ACCEPTED))
                .willReturn(List.of(accepted(10L, ME, OTHER)));
        given(userRepository.findAllById(anyIterable())).willReturn(List.of(user(OTHER, "친구")));
        given(presenceService.findAll(anyCollection())).willReturn(Map.of());

        assertThat(service.listFriends(ME)).singleElement()
                .satisfies(f -> {
                    assertThat(f.userId()).isEqualTo(OTHER);
                    assertThat(f.presence()).isEqualTo("OFFLINE");
                    assertThat(f.currentRoomId()).isNull();
                });
    }

    @Test
    @DisplayName("방에 있는 친구는 IN_ROOM + currentRoomId로 내려간다 — 친구방 입장(-98)이 이 값을 쓴다")
    void inRoomFriendCarriesRoomId() {
        given(friendshipRepository.findAllByUserIdAndStatus(ME, FriendshipStatus.ACCEPTED))
                .willReturn(List.of(accepted(10L, ME, OTHER)));
        given(userRepository.findAllById(anyIterable())).willReturn(List.of(user(OTHER, "친구")));
        given(presenceService.findAll(anyCollection()))
                .willReturn(Map.of(OTHER, PresenceSnapshot.online("MP4X9K")));

        assertThat(service.listFriends(ME)).singleElement()
                .satisfies(f -> {
                    assertThat(f.presence()).isEqualTo("IN_ROOM");
                    assertThat(f.currentRoomId()).isEqualTo("MP4X9K");
                });
    }

    @Test
    @DisplayName("접속 중인 친구가 오프라인 친구보다 위에 온다")
    void onlineFriendsSortFirst() {
        long online = 3L;
        given(friendshipRepository.findAllByUserIdAndStatus(ME, FriendshipStatus.ACCEPTED))
                .willReturn(List.of(accepted(10L, ME, OTHER), accepted(11L, ME, online)));
        // 닉네임만 보면 '가나다'(오프라인)가 '하하하'(온라인)보다 앞선다 — 프레즌스가 정렬을 이긴다.
        given(userRepository.findAllById(anyIterable()))
                .willReturn(List.of(user(OTHER, "가나다"), user(online, "하하하")));
        given(presenceService.findAll(anyCollection()))
                .willReturn(Map.of(online, PresenceSnapshot.online(null)));

        assertThat(service.listFriends(ME))
                .extracting(FriendResponse::nickname)
                .containsExactly("하하하", "가나다");
    }
}
