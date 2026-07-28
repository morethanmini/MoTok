package ssafy.a706.backend.presence.service;

import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.conntime.service.ConnectTimeService;
import ssafy.a706.backend.presence.model.PresenceChangedEvent;
import ssafy.a706.backend.presence.model.PresenceSnapshot;
import ssafy.a706.backend.presence.repository.PresenceRepository;
import ssafy.a706.backend.presence.repository.PresenceRepository.PriorBeat;
import ssafy.a706.backend.presence.repository.PresenceSessionRepository;
import ssafy.a706.backend.presence.repository.PresenceSessionRepository.SessionView;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 접속 상태 갱신·조회 (-57 온라인 표시, -98 친구방 입장의 선행).
 *
 * <p><b>전송은 STOMP, 표현은 그대로</b>(-143) — 비트는 이제 HTTP 요청이 아니라 전역 STOMP 연결의
 * SEND 프레임으로 들어오지만, 여기서 아래로는 아무것도 바뀌지 않는다. {@code presence:{userId}}
 * Redis 표현이 인터페이스이고 소비자(친구 목록·접속시간 스윕·공개 프로필)는 그 표현만 읽는다.
 * 접속시간(-141)의 델타 누적도 "비트 사이 간격"이라는 의미를 그대로 유지하므로 손대지 않았다.</p>
 *
 * <p><b>왜 연결 이벤트만으로는 부족한가</b> — 연결이 살아 있다고 사람이 살아 있는 건 아니다.
 * 노트북 덮개를 닫거나 네트워크가 조용히 끊기면 소켓은 한동안 열린 채로 남는다. 그래서 연결
 * 이벤트(즉시성)와 주기 비트+TTL(진짜 살아있음 확인)을 <b>둘 다</b> 쓴다. 강종은 DISCONNECT가
 * 즉시 잡고, 좀비 연결은 TTL이 60초 안에 걷어낸다.</p>
 *
 * <p><b>방 정보의 주인은 세션 원장이다</b> — 탭마다 보고하는 방이 다르므로(게임룸 탭은 방 ID,
 * 로비 탭은 null) 마지막에 보고한 값을 그대로 쓰면 20초마다 상태가 뒤집힌다. 세션별로 방을
 * 적어 두고 "하나라도 방에 있으면 방에 있는 것"으로 합성한 뒤에야 프레즌스에 쓴다.</p>
 */
@Service
@RequiredArgsConstructor
public class PresenceService {

    /** 하트비트 간격 = TTL의 1/3. 한 번 놓쳐도 아직 TTL이 남아 오프라인으로 튀지 않는다. */
    private static final int HEARTBEAT_DIVISOR = 3;

    private final PresenceRepository presenceRepository;
    private final PresenceSessionRepository sessionRepository;
    private final ConnectTimeService connectTimeService;
    private final ApplicationEventPublisher eventPublisher;

    /**
     * 주기 하트비트 1회 — 세션 원장을 갱신하고 합성된 상태를 프레즌스에 반영한다.
     *
     * @param roomId 이 <b>탭</b>이 보고하는 방. 다른 탭이 방에 있으면 최종 상태는 IN_ROOM이 된다
     * @return 다음 비트까지의 간격(초)
     */
    public long heartbeat(Long userId, String sessionId, String roomId) {
        long now = System.currentTimeMillis();
        // 직전 상태는 touch가 덮어쓰기 전에 읽는다 — 접속시간 델타(-141)와 전이 판정(-149)이 함께 쓴다.
        PriorBeat prior = presenceRepository.readPrior(userId);
        List<SessionView> live = sessionRepository.touch(userId, sessionId, roomId, now);
        applyBeat(userId, prior, PresenceSessionRepository.composeRoomId(live), now);
        return intervalSeconds();
    }

    public long intervalSeconds() {
        return PresenceRepository.TTL.toSeconds() / HEARTBEAT_DIVISOR;
    }

    /**
     * 전역 STOMP 연결 하나가 열렸다(-142/-143). 첫 탭이면 즉시 온라인으로 올린다.
     *
     * <p>연결 시점에는 이 탭이 어느 화면에 있는지 모르므로 방은 비워서 등록하고, 곧 이어질
     * 첫 비트가 채운다. 다른 탭이 이미 방에 있다면 합성 규칙이 그 방을 지켜 준다 —
     * 두 번째 탭을 여는 것만으로 친구 목록에서 "방에서 나간 것처럼" 보이지 않는다.</p>
     */
    public void sessionOpened(Long userId, String sessionId) {
        // 방 안에서 소켓이 한 번 끊겼다 붙는 일은 흔하다(절전 복귀·프록시 유휴 타임아웃·토큰 갱신).
        // 그때 방을 null로 등록하면 합성 결과가 null이 되어 친구 전원에게 "방에서 나갔다"가
        // 잘못 나가고, 곧 이어질 첫 비트가 되돌린다 — 그사이 친구방 입장(-98)은 빈 방을 본다.
        // 직전에 알던 방을 물려주고, 진짜 위치는 곧 오는 첫 비트가 확정한다.
        heartbeat(userId, sessionId, presenceRepository.readPrior(userId).roomId());
    }

    /**
     * 연결 하나가 닫혔다. 남은 탭이 있으면 여전히 접속 중이다.
     *
     * @return 이 사용자의 마지막 연결이었으면 true — 호출부가 유예 후 {@link #offlineIfIdle}을 부른다
     */
    public boolean sessionClosed(Long userId, String sessionId) {
        long now = System.currentTimeMillis();
        List<SessionView> live = sessionRepository.remove(userId, sessionId, now);
        if (live.isEmpty()) {
            return true;
        }
        // 게임룸 탭만 닫았다면 남은 탭 기준으로 즉시 ONLINE이 되어야 한다 — 다음 비트를 기다리지 않는다.
        applyBeat(userId, presenceRepository.readPrior(userId),
                PresenceSessionRepository.composeRoomId(live), now);
        return false;
    }

    /**
     * 유예가 끝난 뒤의 최종 확인. 그 사이 새 탭이 붙었거나 새로고침이 돌아왔으면 아무것도 하지 않는다.
     *
     * <p>유예가 없으면 <b>새로고침 한 번이 로그아웃과 구별되지 않는다</b> — 순단마다 오프라인으로
     * 떨어뜨리면 친구 목록이 깜빡이고, 접속시간 정산(flush)이 새로고침 횟수만큼 DB를 두드린다.</p>
     */
    public void offlineIfIdle(Long userId) {
        long now = System.currentTimeMillis();
        if (!sessionRepository.liveSessions(userId, now).isEmpty()) {
            return;
        }
        PriorBeat prior = presenceRepository.readPrior(userId);
        // 마지막 비트~종료 사이 꼬리 구간까지 셈한 뒤 지운다. 지우고 나면 비트 시각을 알 수 없다.
        connectTimeService.accumulate(userId, prior.heartbeatAt(), now);
        // 검사와 삭제 사이에 재연결이 끼면 갓 붙은 세션을 지우게 된다 — 원자 스크립트로 한 번에.
        if (!sessionRepository.deletePresenceIfIdle(userId)) {
            return;
        }
        connectTimeService.flush(userId);
        if (prior.wasOnline()) {
            eventPublisher.publishEvent(PresenceChangedEvent.offline(userId));
        }
    }

    /** 로그아웃 — TTL도 유예도 기다리지 않고 즉시 오프라인으로 만든다. 접속시간도 이 자리에서 정산한다. */
    public void clear(Long userId) {
        long now = System.currentTimeMillis();
        PriorBeat prior = presenceRepository.readPrior(userId);
        connectTimeService.accumulate(userId, prior.heartbeatAt(), now);
        presenceRepository.delete(userId);
        sessionRepository.delete(userId);
        connectTimeService.flush(userId);
        // 전이 여부를 따지지 않고 무조건 알린다. 프레즌스 키는 TTL(60s)로 조용히 사라질 수 있어
        // (절전·백그라운드 탭·망 단절) 로그아웃 시점에 이미 "오프라인"인 경우가 흔한데,
        // 그때 wasOnline() 가드에 걸려 침묵하면 친구 목록에는 <b>영원히 접속 중으로 박제</b>된다.
        // 델타만 받는 목록에서는 "한 번 놓친 오프라인"을 되찾을 방법이 없다.
        eventPublisher.publishEvent(PresenceChangedEvent.offline(userId));
    }

    public PresenceSnapshot find(Long userId) {
        return presenceRepository.find(userId);
    }

    /** 친구 목록처럼 여러 명을 한꺼번에 볼 때. 결과에 없는 사용자는 오프라인이다. */
    public Map<Long, PresenceSnapshot> findAll(Collection<Long> userIds) {
        return presenceRepository.findAll(userIds);
    }

    /** 합성된 방 정보를 프레즌스에 반영하고, 접속시간을 누적하고, 전이면 알린다. */
    private void applyBeat(Long userId, PriorBeat prior, String roomId, long now) {
        presenceRepository.touch(userId, roomId, now);
        connectTimeService.accumulate(userId, prior.heartbeatAt(), now);
        // 상태가 그대로인 비트는 알리지 않는다 — 전이(오프라인→온라인, 방 이동)만 친구에게 흘린다.
        if (prior.wasOnline() && Objects.equals(prior.roomId(), roomId)) {
            return;
        }
        eventPublisher.publishEvent(PresenceChangedEvent.online(userId, roomId));
    }
}
