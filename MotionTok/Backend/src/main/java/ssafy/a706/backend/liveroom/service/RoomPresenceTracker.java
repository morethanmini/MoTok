package ssafy.a706.backend.liveroom.service;

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
     * 이 회원이 지금 재실 중인 방 목록 — 단일 세션 밀어내기가 SFU 강제 퇴장 대상을 찾을 때 쓴다.
     * 게스트는 계정이 없어 밀려날 일이 없으므로 회원만 본다.
     */
    public List<String> roomsOfMember(Long userId) {
        String id = String.valueOf(userId);
        return sessions.values().stream()
                .filter(o -> !o.principal().isGuest() && id.equals(o.principal().userId()))
                .map(Occupancy::roomId)
                .distinct()
                .toList();
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
