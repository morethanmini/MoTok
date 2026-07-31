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

    /** 로그아웃 시 그 사용자의 모든 연결을 끊는다. 클라이언트에는 정상 종료로 보인다. */
    public void closeAllOf(Long userId) {
        closeAllOf(userId, CloseStatus.NORMAL);
    }

    /**
     * 종료 사유를 실어 끊는다 — 자격을 <b>빼앗긴</b> 경우(관리자 제재)를 위한 것.
     *
     * <p>정상 종료로 끊으면 프론트의 자동 재연결이 그대로 다시 붙는다. 물론 CONNECT 인증에서
     * 다시 막히지만, 사용자에게는 "왜 끊겼는지 모르는 연결 실패"로만 보인다. 1008에 사유를
     * 실어 보내면 그 프레임만으로 안내를 띄울 수 있다.</p>
     */
    public void closeAllOf(Long userId, CloseStatus status) {
        close(detachSessionsOf(userId), status);
    }

    /**
     * 지금 열려 있는 이 사용자의 연결을 원장에서 떼어 내 돌려준다(스냅샷).
     *
     * <p><b>끊기를 뒤로 미뤄야 할 때</b> 쓴다. 원장은 sid가 아니라 userId로만 묶여 있어 옛 세션과
     * 새 세션을 구분하지 못하므로, 미뤄 둔 시점에 목록을 읽으면 그 사이 새로 붙은 연결까지 함께
     * 끊긴다 — 밀어내기의 유예(2초) 안에 새 로그인의 소켓이 붙는 것이 정확히 그 경우다.
     * 대상을 "지금 열려 있는 것"으로 먼저 고정해 두면 나중에 닫아도 새 연결은 무사하다.</p>
     */
    public Set<String> detachSessionsOf(Long userId) {
        Set<String> ids = byUser.remove(userId);
        return ids == null ? Set.of() : ids;
    }

    /** {@link #detachSessionsOf}로 고정해 둔 연결들을 닫는다. */
    public void close(Set<String> sessionIds, CloseStatus status) {
        for (String sessionId : sessionIds) {
            WebSocketSession session = sessions.remove(sessionId);
            if (session == null || !session.isOpen()) {
                continue;
            }
            try {
                session.close(status);
            } catch (IOException e) {
                // 이미 죽은 소켓 — 어차피 DISCONNECT 경로가 정리한다
                log.debug("웹소켓 종료 실패 (sessionId={})", sessionId, e);
            }
        }
    }
}
