package ssafy.a706.backend.auth.session;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.global.config.StompSessionRegistry;
import ssafy.a706.backend.global.notification.UserNotification;
import ssafy.a706.backend.global.notification.UserNotifier;
import ssafy.a706.backend.liveroom.service.RoomPresenceTracker;
import ssafy.a706.backend.video.provider.SfuParticipantEjector;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

/**
 * 한 계정은 한 곳에서만 — 새 로그인이 기존 세션을 밀어낸다.
 *
 * <h4>왜 필요한가</h4>
 * Refresh 토큰은 이미 사용자당 하나뿐이라(auth:refresh:{userId}) 새로 로그인하면 <b>옛 기기의 갱신은
 * 그 순간 죽는다</b>. 하지만 옛 기기의 액세스 토큰은 만료까지 그대로 살아 있고, STOMP 인증은 CONNECT
 * 때 한 번뿐이라 이미 열린 소켓도 계속 유효하다. 그래서 비밀번호가 샌 뒤 남이 로그인해도 원래 주인은
 * <b>아무것도 모른 채</b> 한동안 같이 접속해 있게 된다. 밀려난 쪽에 그 사실을 알리고 연결을 끊는다.
 *
 * <h4>끊는 순서 — 폐기가 먼저, 알림이 다음, 연결이 마지막</h4>
 * <ol>
 *   <li><b>sid 폐기</b> — 옛 세션의 액세스 토큰을 그 자리에서 무효화한다(SessionRevocationStore).
 *       알림을 무시하는 클라이언트도 다음 REST 요청·STOMP 재연결부터 401로 막힌다.</li>
 *   <li><b>알림</b> — 브로커 채널을 거쳐 비동기로 나간다. 소켓을 곧바로 닫으면 프레임이 실려 나가기
 *       전에 전송 계층이 사라져 <b>아무 안내 없이 끊긴 것</b>이 되므로, 짧게 유예를 두고 닫는다.</li>
 *   <li><b>SFU 강제 퇴장</b> — 옛 기기가 게임 방에 있었다면 미디어서버 연결도 서버가 직접 끊는다.
 *       LiveKit 토큰은 우리 JWT와 별개라 sid 폐기가 닿지 않는다 — 이걸 빼면 밀려난 기기가
 *       방의 화상·음성을 계속 보고 듣는다. 방 상태 정리는 STOMP 끊김이 RoomPresenceTracker를
 *       거쳐 퇴장 처리로 이어지므로 여기서 따로 하지 않는다.</li>
 * </ol>
 * 정상 클라이언트는 알림을 받은 즉시 스스로 로그아웃하므로 강제 수단들은 그걸 무시하는 쪽을 위한 보루다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SingleSessionPolicy {

    /** 알림 프레임이 나갈 시간. 사람이 체감하기엔 짧고, 브로커가 밀린 상황에서도 충분한 정도. */
    private static final long CLOSE_DELAY_SECONDS = 2;

    private static final Executor DELAYED = CompletableFuture.delayedExecutor(CLOSE_DELAY_SECONDS, TimeUnit.SECONDS);

    private final UserNotifier userNotifier;
    private final StompSessionRegistry stompSessionRegistry;
    private final SessionRevocationStore sessionRevocationStore;
    private final RoomPresenceTracker roomPresenceTracker;
    private final SfuParticipantEjector sfuParticipantEjector;

    /** 로그인·소셜 로그인으로 새 세션이 생길 때, 같은 사용자의 기존 세션·연결을 정리한다. */
    public void displacePrevious(Long userId) {
        sessionRevocationStore.revokeCurrent(userId, SessionRevocationStore.Reason.DISPLACED);
        userNotifier.notify(userId, UserNotification.sessionDisplaced());

        // 재실 목록은 지금 읽고, 미디어서버 호출(HTTP)은 로그인 응답을 잡지 않게 비동기로 보낸다.
        List<String> rooms = roomPresenceTracker.roomsOfMember(userId);
        if (!rooms.isEmpty()) {
            CompletableFuture.runAsync(() -> rooms.forEach(roomId ->
                    sfuParticipantEjector.eject(roomId, String.valueOf(userId))));
        }

        CompletableFuture.runAsync(() -> {
            try {
                stompSessionRegistry.closeAllOf(userId);
            } catch (RuntimeException e) {
                // 끊기에 실패해도 로그인 자체는 이미 끝났다 — 흔적만 남긴다.
                log.warn("이전 세션 연결 종료 실패 (userId={})", userId, e);
            }
        }, DELAYED);
    }
}
