package ssafy.a706.backend.presence.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.global.config.StompSessionRegistry;

import java.security.Principal;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 전역 STOMP 연결 수명을 프레즌스에 잇는다(-142/-143) — 로그인 즉시 온라인, 강종 즉시 오프라인.
 *
 * <p><b>전환의 핵심</b> — 종전에는 클라이언트가 20초마다 HTTP 하트비트를 쳐야 온라인이 됐고,
 * 브라우저를 강제 종료하면 TTL이 만료되는 최대 60초 동안 남에게는 계속 접속 중으로 보였다.
 * 이제 소켓이 닫히면 OS가 FIN을 보내고 DISCONNECT가 즉시 발화하므로 그 지연이 사라진다.</p>
 *
 * <p><b>왜 유예를 두는가</b> — 새로고침(F5)도 DISCONNECT다. 그 자리에서 오프라인으로 내리면
 * 친구 목록이 새로고침마다 깜빡이고, 접속시간 정산(flush)이 새로고침 횟수만큼 DB를 두드린다.
 * {@value #GRACE_MS}ms 뒤에 다시 확인해서 그때도 세션이 없을 때만 내린다
 * (RoomPresenceTracker가 방 단위로 쓰는 것과 같은 패턴·같은 값).</p>
 *
 * <p><b>게스트는 대상이 아니다</b> — 게스트도 STOMP CONNECT는 한다(1인방 게임 이벤트를 받아야 하므로).
 * 다만 RDB에 없어 친구를 가질 수 없으니 프레즌스를 남에게 보여줄 이유가 없고, 애초에
 * {@code presence:{userId}}는 회원 PK(Long) 기반이라 {@code guest-xxxx} 문자열이 들어오면 파싱에서 터진다.
 * HTTP 시절엔 SecurityConfig가 막아 줬지만 {@code /ws/**}는 permitAll이라 여기서 직접 걸러야 한다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PresenceSessionTracker {

    /** 끊김 후 이 시간 안에 다시 연결되면 오프라인으로 보지 않는다(새로고침·네트워크 블립 보호). */
    private static final long GRACE_MS = 15_000;

    private final PresenceService presenceService;
    private final StompSessionRegistry stompSessionRegistry;

    /** sessionId → userId. DISCONNECT 프레임에는 Principal이 없을 수 있어 연결 시점에 기억해 둔다. */
    private final Map<String, Long> sessions = new ConcurrentHashMap<>();

    private final ScheduledExecutorService reaper = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "presence-reaper");
        thread.setDaemon(true);
        return thread;
    });

    @EventListener
    public void onConnected(SessionConnectedEvent event) {
        String sessionId = StompHeaderAccessor.wrap(event.getMessage()).getSessionId();
        Long userId = memberIdOf(event.getUser());
        if (sessionId == null || userId == null) {
            return;
        }
        sessions.put(sessionId, userId);
        // 로그아웃 시 서버가 이 연결을 직접 끊을 수 있도록 신원을 알려 준다 — Principal이 확정되는 건 지금부터다.
        stompSessionRegistry.bind(userId, sessionId);
        presenceService.sessionOpened(userId, sessionId);
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        Long userId = sessions.remove(event.getSessionId());
        if (userId == null) {
            return; // 게스트이거나 인증 전에 끊긴 세션 — 프레즌스와 무관
        }
        stompSessionRegistry.unbind(userId, event.getSessionId());
        if (!presenceService.sessionClosed(userId, event.getSessionId())) {
            return; // 다른 탭이 살아 있다 — 이 사람은 여전히 접속 중
        }
        reaper.schedule(() -> offline(userId), GRACE_MS, TimeUnit.MILLISECONDS);
    }

    private void offline(Long userId) {
        try {
            presenceService.offlineIfIdle(userId);
        } catch (RuntimeException e) {
            // 정산 실패는 버퍼가 보존되어 다음 스윕이 재시도한다 — 리퍼 스레드는 계속 살려 둔다.
            log.warn("프레즌스 오프라인 처리 실패 (userId={})", userId, e);
        }
    }

    /** 회원 세션만 프레즌스 대상. 게스트·미인증은 null. */
    private Long memberIdOf(Principal user) {
        if (user instanceof Authentication auth
                && auth.getPrincipal() instanceof AuthPrincipal principal
                && principal instanceof MemberPrincipal member) {
            return member.id();
        }
        return null;
    }
}
