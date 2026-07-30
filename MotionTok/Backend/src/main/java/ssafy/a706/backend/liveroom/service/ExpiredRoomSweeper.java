package ssafy.a706.backend.liveroom.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.game.GameSessionRepository;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.presence.repository.PresenceRepository;
import ssafy.a706.backend.rhythm.RhythmSessionRepository;

import java.util.Map;

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

    /**
     * 순찰 주기 — 원래 5분이었으나 1분으로 당겼다(-164). 여기서 잡는 것들(정산 타이머 유실로
     * 잠긴 PLAYING 방, 프레즌스가 끊긴 유령 멤버)은 정상 경로가 아니라 예외 상황이지만,
     * 그동안 "아무도 입장 못 하는 방"이 서 있게 되므로 복구 지연은 짧을수록 좋다.
     * 비용은 방 최대 200개의 해시 조회 수준이라 1분 주기로도 무시할 만하다.
     */
    private static final long SWEEP_INTERVAL_MS = 60_000;

    /**
     * PLAYING 복구 유예(-164) — 정산 타이머는 endAt+1.5s(그림은 +60s 채점 유예)에 발화하므로,
     * endAt에서 이 시간이 지나도록 PLAYING이면 타이머가 죽은 것이다(서버 재시작으로 인메모리
     * 예약 유실 등). 방치하면 아무도 입장 못 하는 방이 24h TTL까지 남는다.
     */
    private static final long PLAYING_RECOVERY_GRACE_MS = 120_000;

    private final LiveRoomRepository repository;
    private final LobbyBroadcaster lobbyBroadcaster;
    private final GameSessionRepository gameSessionRepository;
    private final RhythmSessionRepository rhythmSessionRepository;
    private final LiveRoomService liveRoomService;
    private final PresenceRepository presenceRepository;

    @Scheduled(fixedDelay = SWEEP_INTERVAL_MS)
    public void sweep() {
        int removed = 0;
        long now = System.currentTimeMillis();
        for (String roomId : repository.listRoomIdsNewestFirst(SCAN_LIMIT)) {
            Map<Object, Object> fields = repository.findRoomFields(roomId).orElse(null);
            if (fields == null) {
                repository.removeFromIndex(roomId);
                // 로비 화면에 남아 있을 카드도 함께 치운다 — push만 보는 클라이언트는
                // 목록을 다시 받지 않으므로 여기서 알려 주지 않으면 유령 카드가 그대로 남는다.
                lobbyBroadcaster.roomClosed(roomId);
                removed++;
                continue;
            }
            // 정산 타이머가 유실된 PLAYING 방 복구(-164) — 게임·리듬 어느 세션도 살아 있지 않으면
            // 상태를 되돌려 입장을 다시 연다(changeStatus가 로비 갱신까지 함께 쏜다).
            if ("PLAYING".equals(fields.get("status")) && !hasLiveSession(roomId, now)) {
                liveRoomService.changeStatus(roomId, "WAITING");
                log.warn("정산 타이머 유실 방 복구(PLAYING→WAITING): room={}", roomId);
                continue;
            }
            // 유령 멤버 정리(-164 후속) — 크래시·강력새로고침으로 leave가 서버에 닿지 못한 멤버는
            // members 해시에 24h 남아 방이 로비에 유령으로 잔존했다(같은 이름 방 2개의 근원).
            // 프레즌스(presence:{userId}, TTL 60s)가 완전히 사라진 회원을 일반 퇴장과 동일하게
            // 내보낸다. 게임 중(PLAYING)에는 건드리지 않는다 — 일시적 끊김일 수 있고, 정산이
            // 끝나 WAITING으로 돌아온 다음 순찰에서 정리해도 늦지 않다.
            if ("WAITING".equals(fields.get("status"))) {
                evictGhostMembers(roomId);
            }
        }
        if (removed > 0) {
            log.info("만료된 방 인덱스 정리: {}건", removed);
        }
    }

    private void evictGhostMembers(String roomId) {
        for (LiveRoomMemberValue member : repository.findMembers(roomId)) {
            if (member.guest()) {
                continue; // 게스트는 프레즌스 대상이 아니다(하트비트를 보내지 않음)
            }
            Long userId;
            try {
                userId = Long.parseLong(member.userId());
            } catch (NumberFormatException e) {
                continue;
            }
            if (presenceRepository.readPrior(userId).wasOnline()) {
                continue; // 살아 있는 멤버
            }
            // 오판(일시적 끊김)이어도 복귀한 클라이언트가 자기 MEMBER_LEFT를 보고 재입장한다(FE 자기치유)
            try {
                liveRoomService.evictGhostMember(roomId, member);
                log.warn("프레즌스 끊긴 유령 멤버 퇴장: room={} user={}", roomId, member.userId());
            } catch (RuntimeException e) {
                // 앞선 퇴장으로 방이 사라졌거나(마지막 멤버) 동시 퇴장과 경합 — 다음 순찰에서 다시 본다
                log.debug("유령 멤버 퇴장 건너뜀: room={} user={}", roomId, member.userId(), e);
            }
        }
    }

    private boolean hasLiveSession(String roomId, long now) {
        boolean gamePlaying = gameSessionRepository.findSession(roomId)
                .map(s -> s.isPlaying(now, PLAYING_RECOVERY_GRACE_MS))
                .orElse(false);
        boolean rhythmPlaying = rhythmSessionRepository.findSession(roomId)
                .map(s -> s.isPlaying(now, PLAYING_RECOVERY_GRACE_MS))
                .orElse(false);
        return gamePlaying || rhythmPlaying;
    }
}
