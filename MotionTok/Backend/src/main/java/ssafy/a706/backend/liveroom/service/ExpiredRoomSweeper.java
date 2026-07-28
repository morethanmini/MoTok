package ssafy.a706.backend.liveroom.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;

/**
 * 만료된 방을 인덱스에서 걷어낸다(-148 부속).
 *
 * <h4>왜 지금 필요해졌나</h4>
 * {@code room:{roomId}} 해시는 TTL 24시간으로 조용히 사라지지만 {@code rooms:index} ZSET 항목은
 * 남는다. 지금까지는 방 목록 조회가 "인덱스에는 있는데 해시가 없는" 방을 발견할 때마다
 * 인덱스에서 지우는 lazy 청소를 겸했다 — 로비가 12초마다 목록을 폴링했으니 사실상 상시로 돌던 셈이다.
 *
 * <p>그 폴링을 STOMP push로 걷어내면 <b>lazy 청소도 함께 사라진다.</b> 아무도 목록을 부르지 않으면
 * 죽은 방 항목이 인덱스에 영원히 쌓이고, 새로 들어온 사람이 목록을 처음 열 때 그 유령들이
 * 스캔 상한(50개)을 잡아먹어 멀쩡한 방이 안 보이게 된다. 폴링이 부수적으로 해 주던 일을
 * 명시적인 청소기로 옮기는 것이다.</p>
 *
 * <p>주기가 성긴 이유 — 방 TTL이 24시간이라 급할 게 없고, 정상 종료된 방은 이미
 * {@code deleteRoom()}이 인덱스까지 지운다. 여기서 걸리는 건 크래시·TTL 만료 같은 예외 경로뿐이다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ExpiredRoomSweeper {

    /** 인덱스 스캔 상한 — 방 목록 조회와 같은 값이면 "목록에 보일 수 있는 범위"를 정확히 덮는다. */
    private static final int SCAN_LIMIT = 200;

    private static final long SWEEP_INTERVAL_MS = 5 * 60_000;

    private final LiveRoomRepository repository;
    private final LobbyBroadcaster lobbyBroadcaster;

    @Scheduled(fixedDelay = SWEEP_INTERVAL_MS)
    public void sweep() {
        int removed = 0;
        for (String roomId : repository.listRoomIdsNewestFirst(SCAN_LIMIT)) {
            if (repository.findRoomFields(roomId).isEmpty()) {
                repository.removeFromIndex(roomId);
                // 로비 화면에 남아 있을 카드도 함께 치운다 — push만 보는 클라이언트는
                // 목록을 다시 받지 않으므로 여기서 알려 주지 않으면 유령 카드가 그대로 남는다.
                lobbyBroadcaster.roomClosed(roomId);
                removed++;
            }
        }
        if (removed > 0) {
            log.info("만료된 방 인덱스 정리: {}건", removed);
        }
    }
}
