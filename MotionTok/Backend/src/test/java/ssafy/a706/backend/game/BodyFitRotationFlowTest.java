package ssafy.a706.backend.game;

import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.game.dto.GameEventResponse;
import ssafy.a706.backend.game.dto.GameFinishRequest;
import ssafy.a706.backend.game.dto.GameStartRequest;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.model.GamePlayerScore;
import ssafy.a706.backend.game.model.GameSession;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ScheduledFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 게임④ 출제자 로테이션 전체 흐름 — 인메모리 저장소로 N명 × N라운드를 끝까지 돌려본다.
 *
 * <p>기존 GameSessionServiceTest는 라운드 한 번 넘기는 것만 봤다(mock이 상태를 안 들고 있어
 * 3라운드째를 재현할 수 없었다). "3명 이상일 때 3번째 라운드부터 화면이 깨진다"는 제보를
 * 서버 이벤트 순서로 재현/반증하려고 상태를 들고 있는 fake를 쓴다.</p>
 */
class BodyFitRotationFlowTest {

    private static final String ROOM_ID = "R1AB2C";
    private static final String GAME_TOPIC = "/topic/rooms/" + ROOM_ID + "/game";

    private final RoomMembershipReader membershipReader = mock(RoomMembershipReader.class);
    private final LiveRoomRepository liveRoomRepository = mock(LiveRoomRepository.class);
    private final GameRepository gameRepository = mock(GameRepository.class);
    private final SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
    private final TaskScheduler taskScheduler = mock(TaskScheduler.class);
    private final ApplicationEventPublisher eventPublisher = mock(ApplicationEventPublisher.class);

    private final FakeSessionRepository sessions = new FakeSessionRepository();
    private final List<GameEventResponse> events = new ArrayList<>();

    private final GameSessionService service = new GameSessionService(
            membershipReader, liveRoomRepository, sessions, gameRepository,
            messagingTemplate, taskScheduler, eventPublisher);

    private void givenRoom(int playerCount) {
        List<LiveRoomMemberValue> members = new ArrayList<>();
        for (int i = 1; i <= playerCount; i++) {
            members.add(new LiveRoomMemberValue(String.valueOf(i), "P" + i, false, i));
        }
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        when(liveRoomRepository.findRoomFields(ROOM_ID))
                .thenReturn(Optional.of(Map.of("hostUserId", "1")));
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(members);
        when(gameRepository.findById(4L)).thenReturn(Optional.of(Game.builder()
                .id(4L).name("몸 끼워 맞추기").roundDurationSec(30).countdownSec(3).active(true).build()));
        when(taskScheduler.schedule(any(Runnable.class), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        // 브로드캐스트 캡처 — 이벤트 순서가 이 테스트의 관심사다
        when(messagingTemplate.toString()).thenReturn("mock");
        org.mockito.Mockito.doAnswer(inv -> {
            events.add(inv.getArgument(1, GameEventResponse.class));
            return null;
        }).when(messagingTemplate).convertAndSend(eq(GAME_TOPIC), any(Object.class));
    }

    /** 이번 라운드 출제자를 뺀 전원이 제출 → 조기 정산으로 다음 라운드가 열린다. */
    private void allPlayersFinish(int playerCount) {
        String setter = sessions.session.setterUserId();
        for (int i = 1; i <= playerCount; i++) {
            String uid = String.valueOf(i);
            if (uid.equals(setter)) {
                continue;
            }
            service.finish(ROOM_ID, new GameFinishRequest(70, 0), new MemberPrincipal((long) i, "P" + i));
        }
    }

    private List<GameEventResponse> starts() {
        return events.stream()
                .filter(e -> e.type() == GameEventResponse.EventType.GAME_START)
                .toList();
    }

    @Test
    void 세명이_세라운드를_끝까지_돌면_전원이_한_번씩_출제하고_마지막에_GAME_END가_온다() {
        givenRoom(3);
        service.start(ROOM_ID, new GameStartRequest(4L, null, "easy"), new MemberPrincipal(1L, "P1"));

        allPlayersFinish(3); // 라운드1 종료 → 라운드2
        allPlayersFinish(3); // 라운드2 종료 → 라운드3
        allPlayersFinish(3); // 라운드3 종료 → GAME_END

        System.out.println("=== 3인 이벤트 순서 ===");
        events.forEach(e -> System.out.printf(
                "%-15s setter=%s roundNo=%s/%s startAt=%s endAt=%s%n",
                e.type(), e.setterUserId(), e.roundNo(), e.totalRounds(), e.startAt(), e.endAt()));

        assertThat(starts()).hasSize(3);
        // 순서는 셔플이라 고정할 수 없다 — 전원이 정확히 한 번씩 출제하는 것이 불변식이다
        assertThat(starts().stream().map(GameEventResponse::setterUserId))
                .containsExactlyInAnyOrder("1", "2", "3");
        assertThat(starts().stream().map(GameEventResponse::roundNo)).containsExactly(1, 2, 3);
        // 라운드2·3도 출제 페이즈(5s)가 온전히 남아있어야 한다 — startAt 이후 5s가 출제 창이다
        starts().forEach(e -> assertThat(e.endAt() - e.startAt())
                .as("라운드 길이(출제5s+접근6s)")
                .isEqualTo(11_000));
        // 라운드 사이 휴식 — 다음 라운드 startAt은 브로드캐스트 시각보다 뒤여야 한다
        starts().subList(1, 3).forEach(e -> assertThat(e.startAt() - e.serverNow())
                .as("휴식(ms)")
                .isGreaterThanOrEqualTo(5_000));
        assertThat(events.get(events.size() - 1).type()).isEqualTo(GameEventResponse.EventType.GAME_END);
    }

    @Test
    void 네명이면_네라운드가_전부_열린다() {
        givenRoom(4);
        service.start(ROOM_ID, new GameStartRequest(4L, null, "easy"), new MemberPrincipal(1L, "P1"));

        for (int r = 0; r < 4; r++) {
            allPlayersFinish(4);
        }

        System.out.println("=== 4인 GAME_START 순서 ===");
        starts().forEach(e -> System.out.printf("roundNo=%s setter=%s%n", e.roundNo(), e.setterUserId()));

        assertThat(starts().stream().map(GameEventResponse::setterUserId))
                .containsExactlyInAnyOrder("1", "2", "3", "4");
        assertThat(events.get(events.size() - 1).type()).isEqualTo(GameEventResponse.EventType.GAME_END);
    }

    /**
     * 출제 순서는 셔플이다 — 참가 순(joinedAt)으로 되돌아가면 방을 만든 사람이 매 판 1번
     * 출제자로 고정된다. containsExactlyInAnyOrder만으론 그 회귀를 못 잡으므로 따로 본다.
     */
    @Test
    void 첫_출제자가_매번_같은_사람이_아니다() {
        givenRoom(4);
        Set<String> firstSetters = new HashSet<>();
        for (int i = 0; i < 20; i++) {
            sessions.session = null; // 진행 중 세션 가드 우회 — 매 번 새로 시작
            events.clear();
            service.start(ROOM_ID, new GameStartRequest(4L, null, "easy"), new MemberPrincipal(1L, "P1"));
            firstSetters.add(starts().get(0).setterUserId());
        }
        // 4명 중 20회 모두 같은 사람이 뽑힐 확률은 (1/4)^19 — 사실상 0
        assertThat(firstSetters).hasSizeGreaterThan(1);
    }

    /** 라운드 사이 상태(세션·점수·누적·가드)를 실제 Redis처럼 들고 있는 fake. */
    private static class FakeSessionRepository extends GameSessionRepository {
        GameSession session;
        final Map<String, GamePlayerScore> scores = new LinkedHashMap<>();
        final Map<String, Integer> totals = new HashMap<>();
        final Set<String> guards = new HashSet<>();

        FakeSessionRepository() {
            super(mock(StringRedisTemplate.class));
        }

        @Override
        public void saveSession(String roomId, GameSession s) {
            session = s;
            scores.clear(); // 실제 구현도 세션 저장 시 이번 라운드 점수를 지운다
        }

        @Override
        public Optional<GameSession> findSession(String roomId) {
            return Optional.ofNullable(session);
        }

        @Override
        public void updateChallenge(String roomId, String challenge) {
            session = new GameSession(session.sessionId(), session.gameId(), challenge,
                    session.setterUserId(), session.startAt(), session.endAt(), session.status(),
                    session.setterOrder(), session.roundIndex(), session.difficulty());
        }

        @Override
        public void markEnded(String roomId) {
            session = new GameSession(session.sessionId(), session.gameId(), session.challenge(),
                    session.setterUserId(), session.startAt(), session.endAt(), GameSession.STATUS_ENDED,
                    session.setterOrder(), session.roundIndex(), session.difficulty());
        }

        @Override
        public boolean tryAcquireEndGuard(String roomId, String sessionId, int roundIndex) {
            return guards.add(sessionId + ":" + roundIndex);
        }

        @Override
        public void clearTotals(String roomId) {
            totals.clear();
        }

        @Override
        public void addToTotal(String roomId, String userId, int delta) {
            totals.merge(userId, delta, Integer::sum);
        }

        @Override
        public Map<String, Integer> findTotals(String roomId) {
            return Map.copyOf(totals);
        }

        @Override
        public boolean saveScoreIfAbsent(String roomId, GamePlayerScore score) {
            return scores.putIfAbsent(score.userId(), score) == null;
        }

        @Override
        public Map<String, GamePlayerScore> findScores(String roomId) {
            return Map.copyOf(scores);
        }

        @Override
        public long countScores(String roomId) {
            return scores.size();
        }
    }
}
