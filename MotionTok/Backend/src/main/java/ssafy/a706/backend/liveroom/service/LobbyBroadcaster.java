package ssafy.a706.backend.liveroom.service;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomSummaryResponse;
import ssafy.a706.backend.liveroom.controller.dto.LobbyRoomEvent;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 로비 방 목록 실시간 갱신의 발신부(-148) — 변화를 모았다가 초당 한 번만 내보낸다.
 *
 * <h4>왜 모아서 보내나</h4>
 * 방 하나가 바뀔 때마다 즉시 브로드캐스트하면, 로비에 1,000명이 앉아 있을 때 입퇴장 한 번이
 * write 1,000번이 된다. 8인 방에서 사람들이 우르르 들어오는 순간이면 그게 초당 수천 번으로
 * 불어난다 — 폴링을 없애려다 더 나쁜 걸 만드는 셈이다. 1초 창 안의 변화를 방 단위로 접어
 * (같은 방이 열 번 바뀌어도 마지막 상태 하나만 남는다) 한 프레임에 배열로 담아 보낸다.
 * 결과적으로 로비 구독자 1명당 <b>초당 최대 1프레임</b>이 상한이고, 이 값은 변화가 아무리
 * 많아도 늘지 않는다.
 *
 * <h4>같은 방의 UPDATED와 CLOSED가 겹치면</h4>
 * 방 단위 맵이라 나중 것이 이긴다. 마지막 인원이 나가면서 참가자 수 변경(UPDATED)과
 * 방 폭파(CLOSED)가 연달아 들어와도 클라이언트는 CLOSED 하나만 본다 — 사라진 방의
 * 참가자 수를 그렸다가 지우는 깜빡임이 없다.
 */
@Component
@RequiredArgsConstructor
public class LobbyBroadcaster {

    static final String LOBBY_TOPIC = "/topic/lobby/rooms";

    /** 모으는 창의 길이. 사람이 목록에서 체감하는 지연의 상한이기도 하다. */
    private static final long FLUSH_INTERVAL_MS = 1_000;

    private final SimpMessagingTemplate messagingTemplate;

    /** roomId → 이 창에서 마지막으로 관측된 변화. */
    private final Map<String, LobbyRoomEvent> pending = new ConcurrentHashMap<>();

    public void roomCreated(LiveRoomSummaryResponse room) {
        enqueue(LobbyRoomEvent.created(room));
    }

    public void roomUpdated(LiveRoomSummaryResponse room) {
        enqueue(LobbyRoomEvent.updated(room));
    }

    public void roomClosed(String roomId) {
        enqueue(LobbyRoomEvent.closed(roomId));
    }

    private void enqueue(LobbyRoomEvent event) {
        // 같은 창 안에서 생겼다가 사라진 방은 통째로 버린다(remap이 null이면 항목이 제거된다) —
        // 로비 화면에 뜬 적도 없는 방의 폐쇄 알림은 받는 쪽에서 버릴 정보다.
        pending.merge(event.roomId(), event,
                (previous, next) -> previous.isCreated() && next.isClosed() ? null : next);
    }

    @Scheduled(fixedDelay = FLUSH_INTERVAL_MS)
    public void flush() {
        if (pending.isEmpty()) {
            return;
        }
        List<LobbyRoomEvent> batch = new ArrayList<>();
        // 순회 중 새 이벤트가 들어와도 다음 창으로 넘어갈 뿐이라 유실되지 않는다.
        for (String roomId : List.copyOf(pending.keySet())) {
            LobbyRoomEvent event = pending.remove(roomId);
            if (event != null) {
                batch.add(event);
            }
        }
        if (!batch.isEmpty()) {
            messagingTemplate.convertAndSend(LOBBY_TOPIC, batch);
        }
    }
}
