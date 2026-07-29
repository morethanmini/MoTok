package ssafy.a706.backend.auth.session;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import ssafy.a706.backend.global.config.StompSessionRegistry;
import ssafy.a706.backend.global.notification.UserNotification;
import ssafy.a706.backend.global.notification.UserNotifier;
import ssafy.a706.backend.liveroom.service.RoomPresenceTracker;
import ssafy.a706.backend.video.provider.SfuParticipantEjector;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

/**
 * 단일 세션 밀어내기의 순서 계약 — 폐기가 먼저, 알림이 다음.
 * 알림을 무시하는 클라이언트도 폐기 시점부터는 API가 이미 막혀 있어야 한다.
 */
class SingleSessionPolicyTest {

    private static final long USER_ID = 42L;

    private final UserNotifier userNotifier = mock(UserNotifier.class);
    private final StompSessionRegistry stompSessionRegistry = mock(StompSessionRegistry.class);
    private final SessionRevocationStore sessionRevocationStore = mock(SessionRevocationStore.class);
    private final RoomPresenceTracker roomPresenceTracker = mock(RoomPresenceTracker.class);
    private final SfuParticipantEjector sfuParticipantEjector = mock(SfuParticipantEjector.class);

    private final SingleSessionPolicy policy = new SingleSessionPolicy(
            userNotifier, stompSessionRegistry, sessionRevocationStore,
            roomPresenceTracker, sfuParticipantEjector);

    @Test
    @DisplayName("옛 세션의 sid를 폐기한 뒤에 알린다 — 알림을 무시해도 API는 이미 막혀 있다")
    void revokesBeforeNotifying() {
        given(roomPresenceTracker.roomsOfMember(USER_ID)).willReturn(List.of());

        policy.displacePrevious(USER_ID);

        InOrder order = inOrder(sessionRevocationStore, userNotifier);
        order.verify(sessionRevocationStore)
                .revokeCurrent(USER_ID, SessionRevocationStore.Reason.DISPLACED);
        order.verify(userNotifier).notify(eq(USER_ID), any(UserNotification.class));
        verify(sfuParticipantEjector, never()).eject(anyString(), anyString());
    }

    @Test
    @DisplayName("옛 기기가 방에 있었다면 SFU 미디어도 강제 퇴장시킨다")
    void ejectsSfuParticipantFromOccupiedRooms() {
        given(roomPresenceTracker.roomsOfMember(USER_ID)).willReturn(List.of("room-1", "room-2"));

        policy.displacePrevious(USER_ID);

        // 미디어서버 호출은 로그인 응답을 잡지 않게 비동기로 나간다 — 완료를 잠깐 기다려 확인한다.
        verify(sfuParticipantEjector, timeout(1000)).eject("room-1", "42");
        verify(sfuParticipantEjector, timeout(1000)).eject("room-2", "42");
    }
}
