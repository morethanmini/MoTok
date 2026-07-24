package ssafy.a706.backend.liveroom.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;

import java.security.Principal;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * STOMP 연결 기반 방 재실(在室) 추적 — 서버 권위의 유령 멤버 정리.
 *
 * <p>REST 퇴장(DELETE /members/me)은 클라이언트가 "나갈게요"를 보내야만 동작한다.
 * 탭 강제 종료·브라우저 크래시·네트워크 단절·주소창 이탈처럼 통보 없이 사라지는 경우
 * members 해시에 유령 멤버가 남아 "아무도 없는데 유지되는 방"이 쌓인다. 게임룸은 입장 시
 * 항상 {@code /topic/rooms/{roomId}/chat}을 구독하므로(useRoomChat) 이 구독을 재실 신호로,
 * 연결 끊김 후 유예 시간 안에 재연결이 없으면 서버가 직접 퇴장 처리한다.</p>
 *
 * <ul>
 *   <li>SUBSCRIBE(chat 토픽): 세션 → (방, 사용자) 등록 — 같은 사용자의 다중 탭도 세션별 관리</li>
 *   <li>DISCONNECT: 유예({@value #GRACE_MS}ms, FE 재연결 주기 3초의 여유분) 후에도 그 사용자의
 *       살아있는 세션이 없으면 {@link LiveRoomService#leave} 호출(멱등 — REST 퇴장과 중복돼도 안전)</li>
 * </ul>
 *
 * <p>단일 서버 인스턴스 전제의 인메모리 레지스트리(WebSocketConfig SimpleBroker와 동일 제약).
 * 스케일아웃 시 Redis presence로 교체한다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RoomPresenceTracker {

    /** 게임룸 입장 시 항상 걸리는 대기실 채팅 구독 — 방 재실 판정 기준. */
    private static final Pattern CHAT_TOPIC = Pattern.compile("^/topic/rooms/([^/]+)/chat$");

    /** 끊김 후 이 시간 안에 재구독하면 퇴장으로 보지 않는다(네트워크 블립·자동 재연결 보호). */
    private static final long GRACE_MS = 15_000;

    private final LiveRoomService liveRoomService;

    private record Occupancy(String roomId, AuthPrincipal principal, String presenceKey) {
    }

    /** sessionId → 재실 정보. */
    private final Map<String, Occupancy> sessions = new ConcurrentHashMap<>();
    /** presenceKey(방+사용자) → 살아있는 sessionId 집합. */
    private final Map<String, Set<String>> presence = new ConcurrentHashMap<>();

    private final ScheduledExecutorService reaper = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "room-presence-reaper");
        thread.setDaemon(true);
        return thread;
    });

    @EventListener
    public void onSubscribe(SessionSubscribeEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        String destination = accessor.getDestination();
        String sessionId = accessor.getSessionId();
        AuthPrincipal principal = principalOf(event.getUser());
        if (destination == null || sessionId == null || principal == null) {
            return;
        }
        Matcher matcher = CHAT_TOPIC.matcher(destination);
        if (!matcher.matches()) {
            return;
        }
        String roomId = matcher.group(1);
        String presenceKey = roomId + "|" + (principal.isGuest() ? "g:" : "m:") + principal.userId();
        sessions.put(sessionId, new Occupancy(roomId, principal, presenceKey));
        presence.computeIfAbsent(presenceKey, k -> ConcurrentHashMap.newKeySet()).add(sessionId);
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        Occupancy occupancy = sessions.remove(event.getSessionId());
        if (occupancy == null) {
            return; // 방 구독이 없던 세션(로비 등) — 관심 없음
        }
        Set<String> live = presence.get(occupancy.presenceKey());
        if (live != null) {
            live.remove(event.getSessionId());
        }
        reaper.schedule(() -> reap(occupancy), GRACE_MS, TimeUnit.MILLISECONDS);
    }

    /** 유예 경과 시점 재확인 — 그 사이 재연결(재구독)했으면 재실 유지, 아니면 퇴장 처리. */
    private void reap(Occupancy occupancy) {
        Set<String> live = presence.get(occupancy.presenceKey());
        if (live != null && !live.isEmpty()) {
            return;
        }
        presence.computeIfPresent(occupancy.presenceKey(), (k, v) -> v.isEmpty() ? null : v);
        try {
            liveRoomService.leave(occupancy.principal(), occupancy.roomId());
            log.info("presence reap: room={} user={} — STOMP 끊김 후 {}초 무응답, 퇴장 처리",
                    occupancy.roomId(), occupancy.principal().userId(), GRACE_MS / 1000);
        } catch (BusinessException e) {
            // 방이 이미 사라졌거나(마지막 인원 REST 퇴장) 본인이 이미 나간 상태 — 정리할 것 없음
        }
    }

    private AuthPrincipal principalOf(Principal user) {
        if (user instanceof Authentication auth && auth.getPrincipal() instanceof AuthPrincipal principal) {
            return principal;
        }
        return null;
    }
}
