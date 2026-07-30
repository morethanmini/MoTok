package ssafy.a706.backend.auth.session;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.config.StompSessionRegistry;
import ssafy.a706.backend.global.notification.UserNotification;
import ssafy.a706.backend.global.notification.UserNotifier;
import ssafy.a706.backend.liveroom.service.RoomPresenceTracker;
import ssafy.a706.backend.presence.service.PresenceService;
import ssafy.a706.backend.video.provider.SfuParticipantEjector;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

/**
 * 세션 종료 정리 — "이 계정의 살아 있는 접근을 끝낸다"를 한 곳에 모은 것.
 *
 * <h4>왜 한 곳인가</h4>
 * 세션이 끝나는 경로는 다섯이다 — 로그아웃·밀어내기·탈퇴·비밀번호 변경·비밀번호 재설정.
 * 끝내는 <b>이유</b>는 다르지만 끝내기 위해 해야 할 <b>일</b>은 같은데, 종전에는 경로마다 손으로
 * 나열해 정리 범위가 갈렸다. 로그아웃은 소켓·프레즌스까지 지웠고 탈퇴는 토큰만 지웠다 —
 * 그래서 탈퇴한 계정이 하트비트로 접속 상태를 되살려 친구 목록에 온라인으로 남고, 개인 큐로
 * 귓속말·초대를 계속 받고, LiveKit 화상에 그대로 붙어 있었다. 새 정리 단계가 생길 때마다
 * 다섯 곳을 모두 고쳐야 한다면 또 갈린다. 그래서 <b>순서를 아는 곳은 여기 하나</b>다.
 *
 * <h4>왜 정리가 필요한가 — sid 폐기만으로는 부족하다</h4>
 * {@link SessionRevocationStore}는 <b>다음 요청</b>을 막는 장치다. REST는 요청마다 검사하니 즉시
 * 듣지만, STOMP 인증은 CONNECT 때 한 번뿐이라 <b>이미 열린 소켓에는 소급되지 않는다.</b>
 * SFU(LiveKit) 접속 토큰은 미디어서버가 자기 비밀로 검증하는 별개의 JWT라 아예 닿지도 않는다.
 * 이미 열려 있는 것들은 서버가 직접 끊어야 끊긴다.
 *
 * <p>제재({@code UserSanctionService})는 이 문을 지나지 않는다 — 종료 코드에 사유를 실어
 * (1008 {@code ACCOUNT_SUSPENDED}/{@code BANNED}) 프론트가 안내를 띄우게 하는 것이 계약의
 * 일부이고, 차단 판정도 sid가 아니라 {@code AccountBlockStore}가 맡는다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SessionTerminator {

    /** 알림 프레임이 나갈 시간. 사람이 체감하기엔 짧고, 브로커가 밀린 상황에서도 충분한 정도. */
    private static final long CLOSE_DELAY_SECONDS = 2;

    private static final Executor DELAYED = CompletableFuture.delayedExecutor(CLOSE_DELAY_SECONDS, TimeUnit.SECONDS);

    private final SessionRevocationStore sessionRevocationStore;
    private final RefreshTokenStore refreshTokenStore;
    private final RoomPresenceTracker roomPresenceTracker;
    private final StompSessionRegistry stompSessionRegistry;
    private final PresenceService presenceService;
    private final SfuParticipantEjector sfuParticipantEjector;
    private final UserNotifier userNotifier;

    /**
     * 세션을 지금 끝낸다 — 로그아웃·탈퇴·비밀번호 변경·비밀번호 재설정이 모두 이 문을 지난다.
     *
     * <p><b>순서가 곧 동작이다.</b> 네 곳에서 한 줄씩 순서가 어긋나면 조용히 반쪽만 정리된다.</p>
     * <ol>
     *   <li><b>sid 폐기 → Refresh 삭제</b> — sid는 Refresh 해시 안에 있다. 뒤집으면 폐기가 읽을
     *       sid가 사라져 아무 일도 하지 않는 no-op이 된다.</li>
     *   <li><b>방 퇴장 → 소켓 종료</b> — 소켓을 먼저 끊으면 UNSUBSCRIBE 없이 DISCONNECT만 나서
     *       유예(15초) 동안 방에 유령 멤버로 남는다({@link RoomPresenceTracker} 주석).</li>
     *   <li><b>소켓 종료 → 프레즌스 정리</b> — 프레즌스를 먼저 지우면 아직 열려 있는 소켓의
     *       다음 하트비트가 방금 지운 접속 상태를 <b>되살려</b> 친구 목록에 다시 켜진다.</li>
     * </ol>
     *
     * <p>쓰기 트랜잭션 안에서 부를 것 — 이 안의 접속시간 정산({@code ConnectTimeService.flush})이
     * readOnly 트랜잭션에 참여하면 FlushMode가 MANUAL로 남아 save가 커밋되지 않는다. Redis 버퍼는
     * GETDEL로 이미 비운 뒤라 복원 경로도 타지 않아, 미정산 접속시간이 조용히 유실된다(-141).</p>
     */
    public void terminate(Long userId, SessionRevocationStore.Reason reason) {
        sessionRevocationStore.revokeCurrent(userId, reason);
        refreshTokenStore.delete(userId);

        // 재실 목록은 방을 비우기 전에 읽는다 — 미디어서버에서 끊어야 할 방이 곧 지금 있는 방들이다.
        List<String> rooms = roomPresenceTracker.roomsOfMember(userId);
        roomPresenceTracker.evictFromRooms(userId);
        stompSessionRegistry.closeAllOf(userId);
        presenceService.clear(userId);
        ejectFromSfu(userId, rooms);
    }

    /**
     * 한 계정은 한 곳에서만 — 새 로그인이 기존 세션을 밀어낸다.
     *
     * <p>Refresh 토큰은 이미 사용자당 하나뿐이라(auth:refresh:{userId}) 새로 로그인하면 옛 기기의
     * 갱신은 그 순간 죽는다. 하지만 옛 기기의 액세스 토큰은 만료까지 살아 있고 이미 열린 소켓도
     * 계속 유효하다 — 비밀번호가 샌 뒤 남이 로그인해도 원래 주인은 <b>아무것도 모른 채</b>
     * 한동안 같이 접속해 있게 된다. 밀려난 쪽에 그 사실을 알리고 연결을 끊는다.</p>
     *
     * <p>{@link #terminate}와 갈리는 두 가지가 있다.</p>
     * <ul>
     *   <li><b>알린 뒤에 끊는다</b> — 알림은 브로커 채널을 거쳐 비동기로 나가므로 소켓을 곧바로
     *       닫으면 프레임이 실려 나가기 전에 전송 계층이 사라져 <b>아무 안내 없이 끊긴 것</b>이 된다.
     *       그래서 {@value #CLOSE_DELAY_SECONDS}초 유예를 두고 닫는다.</li>
     *   <li><b>Refresh·프레즌스는 건드리지 않는다</b> — 뒤이어 같은 사용자가 곧바로 다시 붙는다.
     *       Refresh는 새 로그인이 덮어쓰고, 프레즌스를 지우면 친구 목록에 오프라인→온라인이
     *       한 번 깜빡이며 접속시간이 로그인마다 끊겨 정산된다.</li>
     * </ul>
     *
     * <p><b>방 퇴장은 {@link #terminate}와 똑같이 즉시 한다.</b> 종전에는 소켓 종료가
     * {@link RoomPresenceTracker}의 유예 경로를 거쳐 알아서 퇴장으로 이어지도록 맡겼는데, 그 길은
     * {@value #CLOSE_DELAY_SECONDS}초(소켓 종료) + 15초(재연결 유예) = <b>17초</b>가 걸린다.
     * 밀려난 사람이 방장이었다면 그 17초 동안 아무에게도 시작 권한이 없고, SFU 강제 퇴장은 즉시라
     * 남은 참가자 화면에서는 방장이 이미 사라진 상태다 — 프론트는 이걸 "방장이 아직 기기 점검 중"으로
     * 읽어 10초 뒤 입장 대기 오버레이를 띄운다. 유예는 <b>돌아올 수 있는 세션</b>을 위한 것이고
     * 밀려난 세션은 sid가 폐기돼 돌아오지 못하므로, 기다릴 이유가 없다.</p>
     *
     * <p><b>밀어낼 세션이 없으면 아무것도 하지 않는다.</b> 종전에는 이전 세션의 유무와 무관하게
     * 알림을 쏘고 소켓을 닫았다. 그런데 알림·종료는 sid가 아니라 <b>userId로</b> 나가므로, 받는 쪽에는
     * 밀려난 세션과 방금 로그인한 세션이 섞여 있다 — 첫 로그인인데도 "다른 곳에서 로그인했어요"가
     * 뜨고 로그인하자마자 튕기는 자기 발등 찍기가 됐다(로컬에서 Refresh 토큰을 비우고 테스트할 때
     * 특히 잘 재현된다: 밀어낼 세션이 하나도 없는데 알림만 나갔다).
     * 이전 세션의 sid를 먼저 확인하고, 없으면 알릴 대상도 끊을 대상도 없으므로 그대로 돌아간다.</p>
     *
     * <p>sid를 기준으로 삼는 것은 "밀어낸다 = 그 세션을 식별해 폐기한다"이기 때문이다. sid 도입
     * (v0.2.25) 이전에 열린 세션은 폐기할 수단이 없어 알림만 보내는 반쪽 처리가 되므로 대상에서 빠진다 —
     * 그 세션들은 Refresh가 새 로그인에 덮여 죽고 Access는 만료를 기다린다(v0.2.24와 같은 동작).</p>
     */
    public void displacePrevious(Long userId) {
        String previousSid = refreshTokenStore.sessionId(userId);
        if (previousSid == null) {
            return;
        }
        sessionRevocationStore.revoke(previousSid, SessionRevocationStore.Reason.DISPLACED);
        userNotifier.notify(userId, UserNotification.sessionDisplaced());

        // 재실 목록은 방을 비우기 전에 읽는다 — terminate와 같은 이유(비운 뒤엔 끊을 대상을 잃는다).
        List<String> rooms = roomPresenceTracker.roomsOfMember(userId);
        roomPresenceTracker.evictFromRooms(userId);
        ejectFromSfu(userId, rooms);

        CompletableFuture.runAsync(() -> {
            try {
                stompSessionRegistry.closeAllOf(userId);
            } catch (RuntimeException e) {
                // 끊기에 실패해도 로그인 자체는 이미 끝났다 — 흔적만 남긴다.
                log.warn("이전 세션 연결 종료 실패 (userId={})", userId, e);
            }
        }, DELAYED);
    }

    /**
     * 미디어서버 연결 강제 종료. sid 폐기가 닿지 않는 유일한 조각이라, 이걸 빼면 끝난 세션이
     * 방의 화상·음성을 계속 보고 듣는다. 미디어서버 HTTP 호출이므로 응답을 잡지 않게 비동기로 보낸다
     * (실패는 {@link SfuParticipantEjector}가 삼킨다 — best-effort).
     */
    private void ejectFromSfu(Long userId, List<String> rooms) {
        if (rooms.isEmpty()) {
            return;
        }
        String identity = String.valueOf(userId);
        CompletableFuture.runAsync(() -> rooms.forEach(roomId -> sfuParticipantEjector.eject(roomId, identity)));
    }
}
