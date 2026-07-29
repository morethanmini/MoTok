package ssafy.a706.backend.auth.session;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.global.config.StompSessionRegistry;
import ssafy.a706.backend.global.notification.UserNotification;
import ssafy.a706.backend.global.notification.UserNotifier;

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
 * <h4>알린 뒤에 끊는 이유</h4>
 * 알림은 브로커 채널을 거쳐 비동기로 나가는데, 소켓을 곧바로 닫으면 프레임이 실려 나가기 전에
 * 전송 계층이 사라져 <b>아무 안내 없이 끊긴 것</b>이 된다. 짧게 유예를 두고 닫는다.
 * 정상 클라이언트는 알림을 받은 즉시 스스로 로그아웃하므로 이 닫기는 그걸 무시하는 쪽을 위한 보루다.
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

    /** 로그인·소셜 로그인으로 새 세션이 생길 때, 같은 사용자의 기존 연결을 정리한다. */
    public void displacePrevious(Long userId) {
        userNotifier.notify(userId, UserNotification.sessionDisplaced());
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
