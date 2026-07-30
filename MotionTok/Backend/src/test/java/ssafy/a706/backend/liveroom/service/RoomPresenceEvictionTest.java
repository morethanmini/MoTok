package ssafy.a706.backend.liveroom.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 제재 퇴장의 <b>방 쪽 절반</b> — 정지된 회원을 지금 있는 방에서 빼는지.
 *
 * <p>나머지 절반인 소켓 종료는 {@code StompSessionRegistry.closeAllOf}가 맡고
 * 둘을 순서대로 부르는 책임은 {@code UserSanctionService}에 있다(그쪽 테스트 참고).
 * 방에서만 빼면 이미 구독한 토픽을 계속 받고, 소켓만 끊으면 유예 동안 유령 멤버로 남는다.</p>
 */
class RoomPresenceEvictionTest {

    private static final long SUSPENDED_ID = 42L;

    private final LiveRoomService liveRoomService = mock(LiveRoomService.class);
    private final RoomPresenceTracker tracker = new RoomPresenceTracker(liveRoomService);

    /** 방 채팅 구독 = 재실 신호. 실제 경로(SessionSubscribeEvent)로 재실을 만든다. */
    private void subscribe(String sessionId, String roomId, Object principal) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setSessionId(sessionId);
        accessor.setDestination("/topic/rooms/" + roomId + "/chat");
        accessor.setLeaveMutable(true);
        Message<byte[]> message = MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
        Authentication auth = new UsernamePasswordAuthenticationToken(principal, null, List.of());
        tracker.onSubscribe(new SessionSubscribeEvent(this, message, auth));
    }

    private static MemberPrincipal member(long id) {
        return new MemberPrincipal(id, "회원" + id);
    }

    @Test
    @DisplayName("들어가 있던 방에서 뺀다")
    void evictsFromRoom() {
        MemberPrincipal principal = member(SUSPENDED_ID);
        subscribe("sess-1", "room-A", principal);

        assertThat(tracker.evictFromRooms(SUSPENDED_ID)).isEqualTo(1);

        verify(liveRoomService).leave(principal, "room-A");
    }

    @Test
    @DisplayName("여러 탭으로 붙어 있으면 전부 처리한다 — 하나만 빼면 다른 탭으로 계속 남는다")
    void evictsEverySessionOfTheMember() {
        MemberPrincipal principal = member(SUSPENDED_ID);
        subscribe("sess-1", "room-A", principal);
        subscribe("sess-2", "room-B", principal);

        assertThat(tracker.evictFromRooms(SUSPENDED_ID)).isEqualTo(2);

        verify(liveRoomService).leave(principal, "room-A");
        verify(liveRoomService).leave(principal, "room-B");
    }

    @Test
    @DisplayName("다른 회원과 게스트는 건드리지 않는다")
    void leavesOthersAlone() {
        MemberPrincipal target = member(SUSPENDED_ID);
        MemberPrincipal other = member(7L);
        GuestPrincipal guest = new GuestPrincipal("guest-abc12345", "게스트1234");
        subscribe("sess-me", "room-A", target);
        subscribe("sess-other", "room-A", other);
        subscribe("sess-guest", "room-A", guest);

        assertThat(tracker.evictFromRooms(SUSPENDED_ID)).isEqualTo(1);

        verify(liveRoomService).leave(target, "room-A");
        verify(liveRoomService, never()).leave(eq(other), anyString());
        verify(liveRoomService, never()).leave(eq(guest), anyString());
    }

    @Test
    @DisplayName("어느 방에도 없으면 아무 일도 하지 않는다 — 제재 자체는 성공해야 한다")
    void noopWhenNotInAnyRoom() {
        assertThat(tracker.evictFromRooms(SUSPENDED_ID)).isZero();

        verify(liveRoomService, never()).leave(any(), anyString());
    }

    @Test
    @DisplayName("방이 이미 사라져 leave가 실패해도 제재를 막지 않는다 — 소켓 종료는 호출자가 이어서 한다")
    void survivesLeaveFailure() {
        MemberPrincipal principal = member(SUSPENDED_ID);
        subscribe("sess-1", "room-A", principal);
        subscribe("sess-2", "room-B", principal);
        willThrow(new BusinessException(ErrorCode.ROOM_NOT_FOUND))
                .given(liveRoomService).leave(principal, "room-A");

        assertThatCode(() -> assertThat(tracker.evictFromRooms(SUSPENDED_ID)).isEqualTo(2))
                .doesNotThrowAnyException();

        // 한 방이 터져도 나머지 방 처리는 계속된다
        verify(liveRoomService, times(1)).leave(principal, "room-B");
    }
}
