package ssafy.a706.backend.game;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.game.dto.GameEventResponse;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.game.dto.GameFinishRequest;
import ssafy.a706.backend.game.dto.GameStartRequest;
import ssafy.a706.backend.game.model.GamePlayerScore;
import ssafy.a706.backend.game.model.GameSession;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ScheduledFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 게임 세션 서버(S15P11A706-116) 단위 테스트 — Redis·브로커 없이 순수 로직 검증.
 * 시나리오: 방장 검증 / GAME_START 배포·정산 예약 / 제출 멱등성 / 순위 정산(미제출 0점).
 */
@ExtendWith(MockitoExtension.class)
class GameSessionServiceTest {

    private static final String ROOM_ID = "R1AB2C";
    private static final String GAME_TOPIC = "/topic/rooms/" + ROOM_ID + "/game";

    @Mock RoomMembershipReader membershipReader;
    @Mock LiveRoomRepository liveRoomRepository;
    @Mock GameSessionRepository sessionRepository;
    @Mock GameRepository gameRepository;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock TaskScheduler gameTaskScheduler;
    @Mock ApplicationEventPublisher eventPublisher;

    @InjectMocks GameSessionService service;

    @Captor ArgumentCaptor<GameEventResponse> eventCaptor;
    @Captor ArgumentCaptor<Runnable> endTaskCaptor;

    private final MemberPrincipal host = new MemberPrincipal(1L, "방장");
    private final MemberPrincipal member = new MemberPrincipal(2L, "참가자");

    private void givenRoomWithHost() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        when(liveRoomRepository.findRoomFields(ROOM_ID))
                .thenReturn(Optional.of(Map.of("hostUserId", "1")));
    }

    /** 카탈로그에서 게임1(핑거 스타, 라운드 30s·카운트다운 3s)을 조회하도록 스텁. */
    private void givenGame1() {
        when(gameRepository.findById(1L)).thenReturn(Optional.of(Game.builder()
                .id(1L).name("핑거 스타").roundDurationSec(30).countdownSec(3).active(true).build()));
    }

    @Test
    void 방장이_아니면_게임을_시작할_수_없다() {
        givenRoomWithHost();

        assertThatThrownBy(() -> service.start(ROOM_ID, new GameStartRequest(1L, null), member))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.NOT_ROOM_HOST);
    }

    @Test
    void 시작하면_GAME_START를_배포하고_방을_잠그고_정산을_예약한다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(any(Runnable.class), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        givenGame1();

        service.start(ROOM_ID, new GameStartRequest(1L, "orion"), host);

        verify(liveRoomRepository).updateStatus(ROOM_ID, "PLAYING");
        verify(gameTaskScheduler).schedule(any(Runnable.class), any(Instant.class));
        verify(messagingTemplate).convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse event = eventCaptor.getValue();
        assertThat(event.type()).isEqualTo(GameEventResponse.EventType.GAME_START);
        assertThat(event.challenge()).isEqualTo("orion");
        assertThat(event.constellationKey()).isEqualTo("orion"); // 게임① 하위호환 필드 (-137)
        assertThat(event.startAt()).isLessThan(event.endAt());
        assertThat(event.serverNow()).isLessThanOrEqualTo(event.startAt());
    }

    /** -137 일반화: 출제 페이즈가 따로 있는 게임(게임④)은 과제 없이 시작한다. */
    @Test
    void 게임1이_아니면_시작_시_과제가_비어있다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(any(Runnable.class), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        when(gameRepository.findById(4L)).thenReturn(Optional.of(Game.builder()
                .id(4L).name("몸 끼워 맞추기").roundDurationSec(15).countdownSec(3).active(true).build()));

        service.start(ROOM_ID, new GameStartRequest(4L, null), host);

        verify(messagingTemplate).convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse event = eventCaptor.getValue();
        assertThat(event.challenge()).isNull();
        assertThat(event.constellationKey()).isNull();
    }

    @Test
    void 진행중_세션이_있으면_재시작을_거부한다() {
        givenRoomWithHost();
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s1", 1L, "orion", now, now + 30_000, GameSession.STATUS_PLAYING)));
        givenGame1();

        assertThatThrownBy(() -> service.start(ROOM_ID, new GameStartRequest(1L, null), host))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.GAME_SESSION_ALREADY_ACTIVE);
    }

    @Test
    void 중복_제출은_무시되고_브로드캐스트도_없다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s1", 1L, "orion", now - 5_000, now + 25_000, GameSession.STATUS_PLAYING)));
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), any())).thenReturn(false);

        service.finish(ROOM_ID, new GameFinishRequest(95, 5), member);

        verify(messagingTemplate, never()).convertAndSend(eq(GAME_TOPIC), any(GameEventResponse.class));
    }

    @Test
    void 점수는_범위로_클램프되어_기록된다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s1", 1L, "orion", now - 5_000, now + 25_000, GameSession.STATUS_PLAYING)));
        ArgumentCaptor<GamePlayerScore> scoreCaptor = ArgumentCaptor.forClass(GamePlayerScore.class);
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), scoreCaptor.capture())).thenReturn(true);
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 0)));
        when(sessionRepository.countScores(ROOM_ID)).thenReturn(1L);

        service.finish(ROOM_ID, new GameFinishRequest(999, -3), member);

        assertThat(scoreCaptor.getValue().score()).isEqualTo(100);
        assertThat(scoreCaptor.getValue().starsHit()).isZero();
    }

    @Test
    void 시간이_되면_미제출자를_0점으로_포함해_순위를_배포한다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(endTaskCaptor.capture(), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        givenGame1();

        service.start(ROOM_ID, new GameStartRequest(1L, "gemini"), host);
        verify(messagingTemplate).convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        String sessionId = eventCaptor.getValue().sessionId();

        // 라운드 종료 시각 도달 — 예약된 정산 실행
        when(sessionRepository.tryAcquireEndGuard(ROOM_ID, sessionId)).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession(sessionId, 1L, "gemini", 0, 1, GameSession.STATUS_PLAYING)));
        when(sessionRepository.findScores(ROOM_ID)).thenReturn(Map.of(
                "2", new GamePlayerScore("2", "참가자", 88, Map.of("starsHit", 5), 1000)));
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 0)));

        endTaskCaptor.getValue().run();

        verify(sessionRepository).markEnded(ROOM_ID);
        verify(liveRoomRepository).updateStatus(ROOM_ID, "WAITING");
        // GAME_START 1회 + GAME_END 1회
        verify(messagingTemplate, org.mockito.Mockito.times(2))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse end = eventCaptor.getValue();
        assertThat(end.type()).isEqualTo(GameEventResponse.EventType.GAME_END);
        assertThat(end.results()).hasSize(2);
        assertThat(end.results().get(0).userId()).isEqualTo("2");
        assertThat(end.results().get(0).rank()).isEqualTo(1);
        assertThat(end.results().get(0).score()).isEqualTo(88);
        assertThat(end.results().get(1).userId()).isEqualTo("1");
        assertThat(end.results().get(1).finished()).isFalse();
        assertThat(end.results().get(1).score()).isZero();
        // 획득 포인트(-83): 1등(88점, 2인 참가) = (2-1+1)*10 + 88/10 = 28
        assertThat(end.results().get(0).pointsEarned()).isEqualTo(28);
    }
}
