package ssafy.a706.backend.auth.session;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.config.StompSessionRegistry;
import ssafy.a706.backend.global.notification.UserNotification;
import ssafy.a706.backend.global.notification.UserNotifier;
import ssafy.a706.backend.liveroom.service.RoomPresenceTracker;
import ssafy.a706.backend.presence.service.PresenceService;
import ssafy.a706.backend.video.provider.SfuParticipantEjector;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

/**
 * 세션 종료 정리의 순서 계약.
 *
 * <p>정리 단계는 각각 따로 보면 다 "부르기만 하면 되는" 것처럼 보이지만, 순서가 어긋나면
 * <b>불렸는데도 아무 일이 일어나지 않는다.</b> 그래서 이 테스트는 "불렸는가"가 아니라
 * "언제 불렸는가"를 못박는다. 로그아웃·탈퇴·비밀번호 변경·재설정이 모두 이 한 곳을 지나므로,
 * 여기서 고정된 순서가 곧 네 경로의 계약이다.</p>
 */
class SessionTerminatorTest {

    private static final long USER_ID = 42L;

    private final SessionRevocationStore sessionRevocationStore = mock(SessionRevocationStore.class);
    private final RefreshTokenStore refreshTokenStore = mock(RefreshTokenStore.class);
    private final RoomPresenceTracker roomPresenceTracker = mock(RoomPresenceTracker.class);
    private final StompSessionRegistry stompSessionRegistry = mock(StompSessionRegistry.class);
    private final PresenceService presenceService = mock(PresenceService.class);
    private final SfuParticipantEjector sfuParticipantEjector = mock(SfuParticipantEjector.class);
    private final UserNotifier userNotifier = mock(UserNotifier.class);

    private final SessionTerminator terminator = new SessionTerminator(
            sessionRevocationStore, refreshTokenStore, roomPresenceTracker,
            stompSessionRegistry, presenceService, sfuParticipantEjector, userNotifier);

    private static final String PREVIOUS_SID = "sid-42-previous";

    private void inNoRoom() {
        given(roomPresenceTracker.roomsOfMember(USER_ID)).willReturn(List.of());
    }

    /** 밀어낼 이전 세션이 있는 상태. sid가 없으면 displacePrevious는 아무것도 하지 않는다. */
    private void hasPreviousSession() {
        given(refreshTokenStore.sessionId(USER_ID)).willReturn(PREVIOUS_SID);
    }

    @Nested
    @DisplayName("terminate — 로그아웃·탈퇴·비밀번호 변경·재설정")
    class Terminate {

        @Test
        @DisplayName("폐기 → Refresh 삭제 → 방 퇴장 → 소켓 종료 → 프레즌스 정리 순으로 끝낸다")
        void followsTheOrderThatMakesEachStepEffective() {
            inNoRoom();

            terminator.terminate(USER_ID, SessionRevocationStore.Reason.WITHDRAWN);

            InOrder order = inOrder(sessionRevocationStore, refreshTokenStore,
                    roomPresenceTracker, stompSessionRegistry, presenceService);
            // sid는 Refresh 해시 안에 있다 — delete가 먼저 돌면 폐기가 조용히 no-op이 된다.
            order.verify(sessionRevocationStore)
                    .revokeCurrent(USER_ID, SessionRevocationStore.Reason.WITHDRAWN);
            order.verify(refreshTokenStore).delete(USER_ID);
            // 방이 소켓보다 먼저 — 뒤집으면 UNSUBSCRIBE 없이 DISCONNECT만 나서 유예(15s) 동안 유령 멤버로 남는다.
            order.verify(roomPresenceTracker).evictFromRooms(USER_ID);
            order.verify(stompSessionRegistry).closeAllOf(USER_ID);
            // 프레즌스가 소켓보다 나중 — 먼저 지우면 아직 열린 소켓의 다음 하트비트가 되살린다.
            order.verify(presenceService).clear(USER_ID);
        }

        @Test
        @DisplayName("폐기 사유는 호출자가 정한 그대로 넘어간다 — DISPLACED로 새면 프론트가 엉뚱한 안내를 띄운다")
        void passesTheCallersReasonThrough() {
            inNoRoom();

            terminator.terminate(USER_ID, SessionRevocationStore.Reason.CREDENTIALS_CHANGED);

            verify(sessionRevocationStore)
                    .revokeCurrent(USER_ID, SessionRevocationStore.Reason.CREDENTIALS_CHANGED);
            // 밀어내기가 아니므로 "다른 곳에서 로그인" 알림도 나가지 않는다.
            verify(userNotifier, never()).notify(anyLong(), any(UserNotification.class));
        }

        @Test
        @DisplayName("방에 있었다면 SFU 미디어까지 끊는다 — LiveKit 토큰은 sid 폐기가 닿지 않는다")
        void ejectsSfuParticipantFromOccupiedRooms() {
            given(roomPresenceTracker.roomsOfMember(USER_ID)).willReturn(List.of("room-1", "room-2"));

            terminator.terminate(USER_ID, SessionRevocationStore.Reason.WITHDRAWN);

            // 미디어서버 호출(HTTP)은 응답을 잡지 않게 비동기로 나간다 — 완료를 잠깐 기다려 확인한다.
            verify(sfuParticipantEjector, timeout(1000)).eject("room-1", "42");
            verify(sfuParticipantEjector, timeout(1000)).eject("room-2", "42");
        }

        @Test
        @DisplayName("재실 목록은 방을 비우기 전에 읽는다 — 비운 뒤에 읽으면 끊을 대상을 잃는다")
        void readsRoomsBeforeEvicting() {
            inNoRoom();

            terminator.terminate(USER_ID, SessionRevocationStore.Reason.LOGGED_OUT);

            InOrder order = inOrder(roomPresenceTracker);
            order.verify(roomPresenceTracker).roomsOfMember(USER_ID);
            order.verify(roomPresenceTracker).evictFromRooms(USER_ID);
        }

        @Test
        @DisplayName("어느 방에도 없었으면 미디어서버를 부르지 않는다")
        void skipsSfuWhenNotInAnyRoom() {
            inNoRoom();

            terminator.terminate(USER_ID, SessionRevocationStore.Reason.LOGGED_OUT);

            verify(sfuParticipantEjector, never()).eject(anyString(), anyString());
        }
    }

    @Nested
    @DisplayName("displacePrevious — 새 로그인이 기존 세션을 밀어낸다")
    class DisplacePrevious {

        @Test
        @DisplayName("옛 세션의 sid를 폐기한 뒤에 알린다 — 알림을 무시해도 API는 이미 막혀 있다")
        void revokesBeforeNotifying() {
            inNoRoom();
            hasPreviousSession();

            terminator.displacePrevious(USER_ID);

            InOrder order = inOrder(sessionRevocationStore, userNotifier);
            order.verify(sessionRevocationStore)
                    .revoke(PREVIOUS_SID, SessionRevocationStore.Reason.DISPLACED);
            order.verify(userNotifier).notify(eq(USER_ID), any(UserNotification.class));
            verify(sfuParticipantEjector, never()).eject(anyString(), anyString());
        }

        @Test
        @DisplayName("옛 기기가 방에 있었다면 SFU 미디어도 강제 퇴장시킨다")
        void ejectsSfuParticipantFromOccupiedRooms() {
            given(roomPresenceTracker.roomsOfMember(USER_ID)).willReturn(List.of("room-1", "room-2"));
            hasPreviousSession();

            terminator.displacePrevious(USER_ID);

            verify(sfuParticipantEjector, timeout(1000)).eject("room-1", "42");
            verify(sfuParticipantEjector, timeout(1000)).eject("room-2", "42");
        }

        @Test
        @DisplayName("방에서도 즉시 뺀다 — 방장이었다면 위임이 유예(2+15초)를 기다리지 않는다")
        void evictsFromRoomsImmediately() {
            given(roomPresenceTracker.roomsOfMember(USER_ID)).willReturn(List.of("room-1"));
            hasPreviousSession();

            terminator.displacePrevious(USER_ID);

            InOrder order = inOrder(roomPresenceTracker);
            // 재실 목록이 먼저 — 비운 뒤에 읽으면 SFU에서 끊을 방을 잃는다(terminate와 같은 계약).
            order.verify(roomPresenceTracker).roomsOfMember(USER_ID);
            order.verify(roomPresenceTracker).evictFromRooms(USER_ID);
        }

        @Test
        @DisplayName("Refresh·프레즌스는 건드리지 않는다 — 곧 같은 사용자가 다시 붙는다")
        void leavesRefreshAndPresenceToTheNewLogin() {
            inNoRoom();
            hasPreviousSession();

            terminator.displacePrevious(USER_ID);

            // Refresh를 지우면 뒤이어 저장할 새 토큰과 경합하고, 프레즌스를 지우면
            // 친구 목록에 오프라인→온라인이 한 번 깜빡이며 접속시간이 로그인마다 끊겨 정산된다.
            verify(refreshTokenStore, never()).delete(anyLong());
            verify(presenceService, never()).clear(anyLong());
            // 소켓 종료는 알림이 나갈 유예(2초) 뒤라 이 시점에는 아직 닫히지 않았다.
            verify(stompSessionRegistry, never()).closeAllOf(anyLong());
        }

        @Test
        @DisplayName("밀어낼 세션이 없으면 알리지도 끊지도 않는다 — 첫 로그인이 자기 자신을 밀어내면 안 된다")
        void doesNothingWhenThereIsNoPreviousSession() {
            // sessionId가 null = 이전 세션 없음(첫 로그인, 또는 Redis의 Refresh 토큰을 비운 로컬 테스트).
            given(refreshTokenStore.sessionId(USER_ID)).willReturn(null);

            terminator.displacePrevious(USER_ID);

            // 알림·종료는 sid가 아니라 userId로 나간다. 밀어낼 세션이 없는데도 보내면 방금 로그인한
            // 세션이 그 알림을 받아 "다른 곳에서 로그인했어요"를 띄우고 스스로 튕긴다.
            verify(userNotifier, never()).notify(anyLong(), any(UserNotification.class));
            verify(sessionRevocationStore, never()).revoke(anyString(), any());
            verify(roomPresenceTracker, never()).evictFromRooms(anyLong());
            verify(sfuParticipantEjector, never()).eject(anyString(), anyString());
            // 유예 뒤 닫기까지 예약되지 않았는지 — 예약됐다면 2초 뒤 새 세션의 소켓이 끊긴다.
            verify(stompSessionRegistry, after(2500).never()).closeAllOf(anyLong());
        }
    }
}
