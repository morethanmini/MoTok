package ssafy.a706.backend.gameguide;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.gameguide.dto.GameGuideEvent;
import ssafy.a706.backend.gameguide.dto.GameGuideRequests;
import ssafy.a706.backend.liveroom.event.LiveRoomClosedEvent;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 게임 설명 함께 보기 — 방장이 넘기는 페이지를 방 전원의 화면에 맞춘다.
 *
 * <p><b>세션이 아니다.</b> 점수도 타이머도 정산도 없고 게임을 시작하지도 않는다. 방장이
 * "설명 함께 보기"를 고른 동안 모두가 같은 장을 보게 하는 화면 상태 중계가 전부다. 실제
 * 시작은 지금까지대로 {@code /app/rooms/{roomId}/game/start}가 한다 — 여기서 게임을 열지
 * 않으므로 진행 중 세션 검사·최소 인원 같은 규칙을 중복해서 들고 있을 필요가 없다.</p>
 *
 * <p><b>상태를 서버가 들고 있는 이유</b> — 토픽은 재생되지 않는다. 설명이 떠 있는 동안
 * 들어오거나 새로고침한 사람은 방장이 다음 장을 넘길 때까지 아무것도 못 본다. 그래서 마지막
 * 상태를 방별로 기억해 두고 {@link #current}로 돌려준다.</p>
 *
 * <p>보관은 인메모리 맵이다(단일 인스턴스 전제 — {@code GameSessionService.pendingStarts}와
 * 같은 가정). 잃어버려도 설명이 한 번 안 뜰 뿐 게임에는 영향이 없어서 Redis까지 쓰지 않았다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GameGuideService {

    private static final String TOPIC = "/topic/rooms/%s/guide";

    /**
     * 페이지 상한 — 서버는 게임별 설명이 몇 장인지 모른다(그림은 FE에만 있다). 실제 범위는
     * FE가 맞추고 여기선 터무니없는 값만 막는다.
     */
    private static final int MAX_PAGE = 99;

    /**
     * 이 시간이 지난 상태는 없는 것으로 본다. 방장이 닫기를 보내지 못한 채(연결 끊김·탭 종료)
     * 나가면 상태가 남는데, 그걸 그대로 돌려주면 한참 뒤에 들어온 사람에게 아무도 안 보는
     * 설명이 열린다. 닫기 프레임의 유실을 시간으로 덮는 안전망이다.
     */
    private static final long STALE_MILLIS = 10 * 60_000L;

    private final RoomMembershipReader membershipReader;
    private final LiveRoomRepository liveRoomRepository;
    private final SimpMessagingTemplate messagingTemplate;

    private record Shown(GameGuideEvent event, long at) {
    }

    /** roomId → 마지막으로 방송한 열림 상태. 닫으면 지운다(= 없으면 닫힘). */
    private final Map<String, Shown> shown = new ConcurrentHashMap<>();

    /** 방장이 설명을 열거나·넘기거나·닫는다. 어느 쪽이든 전체 상태를 그대로 방송한다. */
    public void publish(String roomId, GameGuideRequests.Publish request, AuthPrincipal sender) {
        Map<Object, Object> roomFields = liveRoomRepository.findRoomFields(roomId)
                .orElseThrow(GameGuideException::roomNotFound);
        requireMembership(roomId, sender);
        if (!sender.userId().equals(roomFields.get("hostUserId"))) {
            throw GameGuideException.notHost();
        }

        GameGuideEvent event = toEvent(request);
        if (event.open()) {
            shown.put(roomId, new Shown(event, System.currentTimeMillis()));
        } else {
            shown.remove(roomId);
        }
        messagingTemplate.convertAndSend(String.format(TOPIC, roomId), event);
    }

    /**
     * 지금 이 방에서 보여야 할 설명 상태 — 입장·재연결 직후 각자 한 번 물어본다.
     * 방장 권한이 필요 없다(보기만 한다). 열려 있지 않으면 닫힘을 돌려준다.
     */
    public GameGuideEvent current(String roomId, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        Shown current = shown.get(roomId);
        if (current == null || System.currentTimeMillis() - current.at() > STALE_MILLIS) {
            return GameGuideEvent.closed();
        }
        return current.event();
    }

    /** 방 폐쇄(-164) — 사라진 방의 상태를 남기지 않는다(리듬·게임 세션과 같은 이유). */
    @EventListener
    public void onRoomClosed(LiveRoomClosedEvent event) {
        shown.remove(event.roomId());
    }

    private GameGuideEvent toEvent(GameGuideRequests.Publish request) {
        if (request == null || !Boolean.TRUE.equals(request.open())) {
            return GameGuideEvent.closed();
        }
        if (request.gameId() == null) {
            throw GameGuideException.gameRequired();
        }
        int page = request.page() == null ? 0 : Math.max(0, Math.min(MAX_PAGE, request.page()));
        return new GameGuideEvent(true, request.gameId(), page);
    }

    private void requireMembership(String roomId, AuthPrincipal sender) {
        if (!membershipReader.existsRoom(roomId)) {
            throw GameGuideException.roomNotFound();
        }
        if (!membershipReader.isMember(roomId, sender.userId())) {
            throw GameGuideException.notInRoom();
        }
    }
}
