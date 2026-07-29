package ssafy.a706.backend.liveroom.service;

import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import org.springframework.web.socket.messaging.SessionUnsubscribeEvent;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.config.StompSessionRegistry;
import ssafy.a706.backend.global.exception.BusinessException;

import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.Objects;
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
 *   <li>UNSUBSCRIBE(그 구독): 방을 나갔다는 뜻. 전역 STOMP 연결(-142) 이후로는 방을 나가도
 *       소켓이 닫히지 않으므로 <b>이쪽이 정상 퇴장 신호</b>가 된다</li>
 *   <li>DISCONNECT: 탭 종료·크래시 등 통보 없는 이탈</li>
 * </ul>
 * 어느 신호든 유예({@value #GRACE_MS}ms, FE 재연결 주기 3초의 여유분) 후에도 그 사용자의
 * 살아있는 세션이 없으면 {@link LiveRoomService#leave}를 호출한다(멱등 — REST 퇴장과 중복돼도 안전).
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

    private record Occupancy(String roomId, AuthPrincipal principal, String presenceKey, String subscriptionId) {
    }

    /** sessionId → 재실 정보. 한 연결은 동시에 방 하나에만 있으므로 세션당 한 칸이면 충분하다. */
    private final Map<String, Occupancy> sessions = new ConcurrentHashMap<>();
    /** presenceKey(방+사용자) → 살아있는 sessionId 집합. */
    private final Map<String, Set<String>> presence = new ConcurrentHashMap<>();

    private final ScheduledExecutorService reaper = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "room-presence-reaper");
        thread.setDaemon(true);
        return thread;
    });

    /**
     * 종료 시 예약된 유예 작업을 버린다 — PresenceSessionTracker.stopReaper와 같은 이유.
     * 리퍼가 데몬이라 컨텍스트가 닫힌 뒤에도 살아 있어서, 그 사이 예약분이 실행되면
     * 이미 닫힌 빈 팩토리를 건드리다 실패하고 스택트레이스만 길게 남는다.
     */
    @PreDestroy
    void stopReaper() {
        reaper.shutdownNow();
    }

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
        sessions.put(sessionId, new Occupancy(roomId, principal, presenceKey, accessor.getSubscriptionId()));
        presence.computeIfAbsent(presenceKey, k -> ConcurrentHashMap.newKeySet()).add(sessionId);
    }

    /**
     * 방 채팅 구독 해제 = 퇴장 신호(-142 전역 연결 대응).
     *
     * <p>전역 STOMP 연결이 생기기 전에는 게임룸을 나가면 소켓 자체가 닫혀 DISCONNECT가 났다.
     * 이제는 <b>연결을 유지한 채 구독만 푼다</b> — DISCONNECT를 기다리면 로그아웃할 때까지
     * 영영 오지 않아 방에 유령 멤버가 남는다. 구독 해제도 끊김과 같은 유예 경로를 태운다
     * (다른 탭이 같은 방에 있으면 재실 유지, 없으면 퇴장 처리 — 판정 로직은 완전히 동일).</p>
     */
    @EventListener
    public void onUnsubscribe(SessionUnsubscribeEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        String sessionId = accessor.getSessionId();
        Occupancy occupancy = sessions.get(sessionId);
        if (occupancy == null || !Objects.equals(occupancy.subscriptionId(), accessor.getSubscriptionId())) {
            return; // 방 구독이 아닌 다른 구독(로비·개인큐 등)의 해제
        }
        sessions.remove(sessionId);
        release(occupancy, sessionId);
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        Occupancy occupancy = sessions.remove(event.getSessionId());
        if (occupancy == null) {
            return; // 방 구독이 없던 세션(로비 등) — 관심 없음
        }
        release(occupancy, event.getSessionId());
    }

    private void release(Occupancy occupancy, String sessionId) {
        Set<String> live = presence.get(occupancy.presenceKey());
        if (live != null) {
            live.remove(sessionId);
        }
        reaper.schedule(() -> reap(occupancy), GRACE_MS, TimeUnit.MILLISECONDS);
    }

    /**
     * 정지된 회원을 지금 있는 방에서 즉시 뺀다(관리자 제재).
     *
     * <p><b>방에서 빼는 것과 연결을 끊는 것은 다른 일이라 여기서는 방만 처리한다.</b>
     * 소켓 종료는 {@link StompSessionRegistry#closeAllOf}가 맡는다 — 사용자→세션 색인을 그쪽이
     * 갖고 있어 어느 방에도 없는 연결(로비에만 붙어 있는 탭)까지 함께 끊을 수 있다. 방에서만
     * 빼고 연결을 두면 이미 구독한 {@code /topic}으로 채팅·게임 이벤트를 계속 받으므로
     * 둘을 함께 해야 실제로 나가며, 순서는 <b>방이 먼저다</b> — 소켓을 먼저 끊으면 UNSUBSCRIBE
     * 없이 DISCONNECT만 나서 유예({@value #GRACE_MS}ms) 동안 유령 멤버로 남는다.</p>
     *
     * <p>{@link LiveRoomService#leave}를 그대로 쓰는 이유 — 방장 위임과 빈 방 정리가 이미 거기 있고,
     * 멱등이라 뒤따르는 소켓 종료로 도는 reaper와 겹쳐도 안전하다. 다른 참가자에게는 평소의
     * 퇴장 이벤트로 보이므로 프론트에 새 계약이 생기지 않는다.</p>
     *
     * @return 방에서 뺀 세션 수(0이면 어느 방에도 없었다)
     */
    public int evictFromRooms(Long userId) {
        String target = String.valueOf(userId);
        List<Map.Entry<String, Occupancy>> victims = sessions.entrySet().stream()
                .filter(e -> !e.getValue().principal().isGuest()
                        && e.getValue().principal().userId().equals(target))
                .toList();

        for (Map.Entry<String, Occupancy> victim : victims) {
            Occupancy occupancy = victim.getValue();
            try {
                liveRoomService.leave(occupancy.principal(), occupancy.roomId());
                log.info("제재 퇴장: room={} user={}", occupancy.roomId(), target);
            } catch (BusinessException e) {
                // 방이 이미 사라졌거나 본인이 이미 나간 상태 — 소켓 종료는 호출자가 그대로 진행한다.
            }
        }
        return victims.size();
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
