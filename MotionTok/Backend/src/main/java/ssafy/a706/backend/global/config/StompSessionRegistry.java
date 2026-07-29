package ssafy.a706.backend.global.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 살아 있는 웹소켓 세션 원장 — <b>서버가 먼저 연결을 끊어야 할 때</b>를 위한 것.
 *
 * <h4>왜 필요해졌나</h4>
 * STOMP 인증은 CONNECT 프레임에서 한 번만 이뤄지고 이후 프레임은 재검증하지 않는다.
 * 연결이 방 하나의 수명(수 분)만큼만 살던 시절엔 무해했지만, 로그인 내내 유지되는 전역
 * 연결(-142)에서는 <b>로그아웃한 뒤에도 그 소켓이 계속 유효</b>하다는 뜻이 된다.
 * 구체적으로: 로그아웃이 프레즌스를 지워도 아직 열려 있는 소켓이 다음 비트를 보내면
 * 프레즌스가 되살아나 친구 목록에 다시 켜진다. 클라이언트가 연결을 닫아 주기를 믿는 대신
 * 서버가 직접 끊는다.
 *
 * <p>{@code WebSocketSession}은 STOMP 계층에서 접근할 수 없어(브로커는 세션 <i>ID</i>만 다룬다)
 * 전송 계층 데코레이터로 붙잡아 둔다. userId 매핑은 CONNECT가 끝나 Principal이 정해진 뒤에야
 * 알 수 있으므로 {@code PresenceSessionTracker}가 세션 이벤트를 받아 채워 준다.</p>
 */
@Slf4j
@Component
public class StompSessionRegistry {

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final Map<Long, Set<String>> byUser = new ConcurrentHashMap<>();

    void register(WebSocketSession session) {
        sessions.put(session.getId(), session);
    }

    void unregister(String sessionId) {
        sessions.remove(sessionId);
    }

    /** CONNECT로 신원이 확정된 뒤 호출된다. */
    public void bind(Long userId, String sessionId) {
        byUser.computeIfAbsent(userId, k -> ConcurrentHashMap.newKeySet()).add(sessionId);
    }

    public void unbind(Long userId, String sessionId) {
        byUser.computeIfPresent(userId, (k, ids) -> {
            ids.remove(sessionId);
            return ids.isEmpty() ? null : ids;
        });
    }

    /** 로그아웃·자격 폐기 시 그 사용자의 모든 연결을 끊는다. 클라이언트에는 정상 종료로 보인다. */
    public void closeAllOf(Long userId) {
        Set<String> ids = byUser.remove(userId);
        if (ids == null) {
            return;
        }
        for (String sessionId : ids) {
            WebSocketSession session = sessions.remove(sessionId);
            if (session == null || !session.isOpen()) {
                continue;
            }
            try {
                session.close(CloseStatus.NORMAL);
            } catch (IOException e) {
                // 이미 죽은 소켓 — 어차피 DISCONNECT 경로가 정리한다
                log.debug("웹소켓 종료 실패 (sessionId={})", sessionId, e);
            }
        }
    }
}
