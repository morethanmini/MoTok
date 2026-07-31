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
import ssafy.a706.backend.game.dto.GameReadyRequest;
import ssafy.a706.backend.game.dto.GameStartRequest;
import ssafy.a706.backend.game.model.GamePlayerScore;
import ssafy.a706.backend.game.model.GameSession;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.liveroom.service.LiveRoomService;
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
    /** 교차 중복 시작 차단(-164) — 기본 모킹은 "리듬 세션 없음"(Optional.empty)이라 기존 시나리오 불변 */
    @Mock ssafy.a706.backend.rhythm.RhythmSessionRepository rhythmSessionRepository;
    @Mock GameRepository gameRepository;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock TaskScheduler gameTaskScheduler;
    @Mock ApplicationEventPublisher eventPublisher;

    /** 방 상태 전환이 서비스 경유로 바뀌었다(-148) — 그 안에 로비 실시간 갱신 알림이 붙어 있다. */
    @Mock LiveRoomService liveRoomService;

    @InjectMocks GameSessionService service;

    @Captor ArgumentCaptor<GameEventResponse> eventCaptor;
    @Captor ArgumentCaptor<Runnable> endTaskCaptor;

    /**
     * -162 시작 준비 확인: start()는 이제 GAME_PREPARE만 배포하고, 실제 세션은 전원 ready
     * 또는 타임아웃에 열린다. 테스트에서는 첫 예약(준비 타임아웃 러너)을 즉시 실행해
     * 기존 "시작 → 세션 생성" 흐름으로 진행시킨다. (ready 경로는 전용 테스트에서 검증)
     */
    private void runPrepareTimeout() {
        endTaskCaptor.getAllValues().get(0).run();
    }

    private final MemberPrincipal host = new MemberPrincipal(1L, "방장");
    private final MemberPrincipal member = new MemberPrincipal(2L, "참가자");

    private void givenRoomWithHost() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        when(liveRoomRepository.findRoomFields(ROOM_ID))
                .thenReturn(Optional.of(Map.of("hostUserId", "1")));
    }

    /** 카탈로그에서 게임1(핑거 스타, 60초 매치·카운트다운 3s)을 조회하도록 스텁. */
    private void givenGame1() {
        when(gameRepository.findById(1L)).thenReturn(Optional.of(Game.builder()
                .id(1L).name("핑거 스타").roundDurationSec(60).countdownSec(3).active(true).build()));
    }

    /** 카탈로그에서 게임4(몸 끼워 맞추기)를 조회하도록 스텁 — 라운드 길이는 모드별로 서버가 따로 정한다. */
    private void givenGame4() {
        when(gameRepository.findById(4L)).thenReturn(Optional.of(Game.builder()
                .id(4L).name("몸 끼워 맞추기").roundDurationSec(15).countdownSec(3).active(true).build()));
    }

    @Test
    void 방장이_아니면_게임을_시작할_수_없다() {
        givenRoomWithHost();

        assertThatThrownBy(() -> service.start(ROOM_ID, new GameStartRequest(1L, null, null, null, null), member))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.NOT_ROOM_HOST);
    }

    /**
     * 관리자가 닫은 게임(-106)은 <b>GAME_NOT_FOUND가 아니다.</b> 닫힌 게임은 카탈로그에 잠긴
     * 카드로 여전히 보이므로 "존재하지 않는다"고 답하면 화면과 어긋나고, 방장은 자기 방이
     * 고장 났다고 읽는다. 다시 열리면 플레이되므로 404가 아니라 409다.
     */
    @Test
    void 관리자가_닫은_게임은_GAME_CLOSED로_거부한다() {
        givenRoomWithHost();
        when(gameRepository.findById(1L)).thenReturn(Optional.of(Game.builder()
                .id(1L).name("핑거 스타").roundDurationSec(60).countdownSec(3).active(false).build()));

        assertThatThrownBy(() -> service.start(ROOM_ID, new GameStartRequest(1L, null, null, null, null), host))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.GAME_CLOSED);
    }

    @Test
    void 카탈로그에_없는_게임은_GAME_NOT_FOUND로_거부한다() {
        givenRoomWithHost();
        when(gameRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.start(ROOM_ID, new GameStartRequest(99L, null, null, null, null), host))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.GAME_NOT_FOUND);
    }

    @Test
    void 시작하면_GAME_START를_배포하고_방을_잠그고_정산을_예약한다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(endTaskCaptor.capture(), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        givenGame1();

        service.start(ROOM_ID, new GameStartRequest(1L, null, null, null, null), host);
        runPrepareTimeout();

        verify(liveRoomService).changeStatus(ROOM_ID, "PLAYING");
        // 준비 타임아웃 1회 + 정산 예약 1회
        verify(gameTaskScheduler, org.mockito.Mockito.times(2))
                .schedule(any(Runnable.class), any(Instant.class));
        // GAME_PREPARE 1회 + GAME_START 1회
        verify(messagingTemplate, org.mockito.Mockito.times(2))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse event = eventCaptor.getValue();
        assertThat(event.type()).isEqualTo(GameEventResponse.EventType.GAME_START);
        // 게임① 과제 = 60초 매치 공유 시드(숫자 문자열) — 전원이 같은 별자리 순서를 뽑는 근거
        assertThat(event.challenge()).matches("\\d+");
        assertThat(event.constellationKey()).isEqualTo(event.challenge()); // 게임① 하위호환 필드 (-137)
        assertThat(event.endAt() - event.startAt()).isEqualTo(60_000); // 60초 매치
        assertThat(event.startAt()).isLessThan(event.endAt());
        assertThat(event.serverNow()).isLessThanOrEqualTo(event.startAt());
    }

    /** -137 일반화: 출제 페이즈가 따로 있는 게임(게임④)은 과제 없이 시작한다. */
    @Test
    void 게임1이_아니면_시작_시_과제가_비어있다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(endTaskCaptor.capture(), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        when(gameRepository.findById(4L)).thenReturn(Optional.of(Game.builder()
                .id(4L).name("몸 끼워 맞추기").roundDurationSec(15).countdownSec(3).active(true).build()));
        // 게임④(-9): 출제자 미참여 룰이라 2인 미만이면 시작이 거부된다 — 방장+참가자 스텁
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 1)));

        service.start(ROOM_ID, new GameStartRequest(4L, null, "hard", null, null), host);
        runPrepareTimeout();

        verify(messagingTemplate, org.mockito.Mockito.times(2))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse event = eventCaptor.getValue();
        assertThat(event.challenge()).isNull();
        assertThat(event.constellationKey()).isNull();
        // 게임④: 출제 순서는 셔플이라 첫 출제자는 방 참가자 중 아무나 — 방장 고정이 아니다
        assertThat(event.setterUserId()).isIn("1", "2");
        assertThat(event.difficulty()).isEqualTo("hard");
        assertThat(event.endAt() - event.startAt()).isEqualTo(9_000);
    }

    /** 게임④(-9): 출제자는 관전만 하므로 1인 방에서는 라운드가 성립하지 않는다 — 시작 거부. */
    @Test
    void 게임4는_1인_방에서_시작할_수_없다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameRepository.findById(4L)).thenReturn(Optional.of(Game.builder()
                .id(4L).name("몸 끼워 맞추기").roundDurationSec(15).countdownSec(3).active(true).build()));
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0)));

        assertThatThrownBy(() -> service.start(ROOM_ID, new GameStartRequest(4L, null, "easy", null, null), host))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.GAME_NEED_MORE_PLAYERS);
    }

    /**
     * 게임④ 연속 서바이벌(-9): 출제자가 없다 — setterOrder를 비워야 endRound의 로테이션 분기가
     * 꺼지고 단판 점수 순위로 정산된다(= 점수제 승부). 시드는 challenge에, 벽 수는 wallCount에 실린다.
     */
    @Test
    void 연속_서바이벌은_출제자없이_시드와_벽수를_배포한다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(endTaskCaptor.capture(), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        givenGame4();
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 1)));

        service.start(ROOM_ID, new GameStartRequest(4L, null, "easy", "chain", 20), host);
        runPrepareTimeout();

        ArgumentCaptor<GameSession> sessionCaptor = ArgumentCaptor.forClass(GameSession.class);
        verify(sessionRepository).saveSession(eq(ROOM_ID), sessionCaptor.capture());
        GameSession saved = sessionCaptor.getValue();
        assertThat(saved.isChain()).isTrue();
        assertThat(saved.setterUserId()).isNull();
        assertThat(saved.setterOrder()).isEmpty(); // 로테이션 분기가 꺼지는 근거
        assertThat(saved.wallCount()).isEqualTo(20);
        assertThat(Long.parseLong(saved.challenge())).isPositive(); // 포즈 시드

        verify(messagingTemplate, org.mockito.Mockito.times(2))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse event = eventCaptor.getValue();
        assertThat(event.mode()).isEqualTo("chain");
        assertThat(event.wallCount()).isEqualTo(20);
        assertThat(event.setterUserId()).isNull();
        assertThat(event.roundNo()).isNull();
        assertThat(event.challenge()).isEqualTo(saved.challenge());
        // 벽 20장이 다 날아올 시간 = FE chainSchedule.chainDurationMs(6000, 20, 5) + 꼬리 여유 1500.
        // FE 테스트(bodyFitChainSchedule.spec.ts)가 42304를 못박고 있다 — 두 언어를 한 테스트에서
        // 돌릴 수 없으므로 같은 숫자를 양쪽에 박아 식이 어긋나는 순간 실패하게 한다.
        assertThat(event.endAt() - event.startAt()).isEqualTo(42_304L + 1_500L);
    }

    /** 벽 수는 서버가 정하는 선택지(10/20/30)만 받는다 — 위조·오타는 기본값으로 떨어뜨린다. */
    @Test
    void 연속_서바이벌_벽수는_선택지밖이면_기본값이_된다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(endTaskCaptor.capture(), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        givenGame4();
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 1)));

        // 0(무한)은 종료 시각을 정할 수 없어 방에서는 허용하지 않는다 — 솔로 전용이다
        service.start(ROOM_ID, new GameStartRequest(4L, null, "easy", "chain", 0), host);
        runPrepareTimeout();

        verify(messagingTemplate, org.mockito.Mockito.times(2))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse event = eventCaptor.getValue();
        assertThat(event.wallCount()).isEqualTo(10);
        // 10벽 = chainDurationMs(6000, 10, 5) 26614 + 꼬리 1500 (FE 테스트와 같은 숫자)
        assertThat(event.endAt() - event.startAt()).isEqualTo(26_614L + 1_500L);
    }

    /**
     * 연속 서바이벌 점수는 누적 총점이 아니라 벽 1장당 평균(0~100)이다 — 상한이 다른 게임과 같다.
     * 총점을 받으면 그 값이 leaderboards.best_score(GREATEST)로 영속되고 PointCalculator
     * (scoreBonus = score/10, 0~100 전제)를 지나면서 게임④ 랭킹·포인트가 모드에 따라 30배 벌어진다.
     */
    @Test
    void 연속_서바이벌도_점수상한은_100이다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s4", 4L, "12345", null, now - 1_000, now + 60_000,
                        GameSession.STATUS_PLAYING, List.of(), 0, "easy", "chain", 10)));
        ArgumentCaptor<GamePlayerScore> scoreCaptor = ArgumentCaptor.forClass(GamePlayerScore.class);
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), scoreCaptor.capture())).thenReturn(true);
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 1)));

        service.finish(ROOM_ID, new GameFinishRequest(78, 0, null), host);
        assertThat(scoreCaptor.getValue().score()).isEqualTo(78); // 평균 78점은 그대로

        service.finish(ROOM_ID, new GameFinishRequest(870, 0, null), member);
        assertThat(scoreCaptor.getValue().score()).isEqualTo(100); // 총점을 보내면 깎인다
    }

    /** 게임④ 출제 페이즈(-86): 출제자 포즈 제출 → challenge 저장 + POSE_SET 배포. */
    @Test
    void 출제자가_포즈를_제출하면_POSE_SET을_배포한다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s4", 4L, null, "1", now - 1_000, now + 11_000,
                        GameSession.STATUS_PLAYING, List.of("1", "2"), 0, "easy", null, 0)));

        service.submitPose(ROOM_ID, new ssafy.a706.backend.game.dto.PoseSubmitRequest("[[0.5,0.5,1]]"), host);

        verify(sessionRepository).updateChallenge(ROOM_ID, "[[0.5,0.5,1]]");
        verify(messagingTemplate).convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse event = eventCaptor.getValue();
        assertThat(event.type()).isEqualTo(GameEventResponse.EventType.POSE_SET);
        assertThat(event.challenge()).isEqualTo("[[0.5,0.5,1]]");
        assertThat(event.setterUserId()).isEqualTo("1");
    }

    @Test
    void 출제자가_아니면_포즈_제출이_거부된다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s4", 4L, null, "1", now - 1_000, now + 11_000,
                        GameSession.STATUS_PLAYING, List.of("1", "2"), 0, "easy", null, 0)));

        assertThatThrownBy(() -> service.submitPose(
                ROOM_ID, new ssafy.a706.backend.game.dto.PoseSubmitRequest("[[0.5,0.5,1]]"), member))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.GAME_NOT_SETTER);
    }

    @Test
    void 진행중_세션이_있으면_재시작을_거부한다() {
        givenRoomWithHost();
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s1", 1L, "orion", null, now, now + 30_000,
                        GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0)));
        givenGame1();

        assertThatThrownBy(() -> service.start(ROOM_ID, new GameStartRequest(1L, null, null, null, null), host))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.GAME_SESSION_ALREADY_ACTIVE);
    }

    /** -162: 전원이 ready를 회신하면 타임아웃을 기다리지 않고 즉시 GAME_START가 열린다. */
    @Test
    void 전원이_ready면_즉시_세션이_시작된다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(endTaskCaptor.capture(), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        givenGame1();
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 1)));

        service.start(ROOM_ID, new GameStartRequest(1L, null, null, null, null), host);
        verify(messagingTemplate).convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse prepare = eventCaptor.getValue();
        assertThat(prepare.type()).isEqualTo(GameEventResponse.EventType.GAME_PREPARE);
        assertThat(prepare.totalCount()).isEqualTo(2);

        service.ready(ROOM_ID, new GameReadyRequest(prepare.prepareId()), host);
        service.ready(ROOM_ID, new GameReadyRequest(prepare.prepareId()), member);

        // GAME_PREPARE + READY_PROGRESS(1/2) + READY_PROGRESS(2/2) + GAME_START
        verify(messagingTemplate, org.mockito.Mockito.times(4))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        assertThat(eventCaptor.getValue().type()).isEqualTo(GameEventResponse.EventType.GAME_START);
        verify(liveRoomService).changeStatus(ROOM_ID, "PLAYING");
    }

    /** -164: 방장 강제종료 — 정산(GameSettledEvent) 없이 GAME_ABORTED가 배포되고 방이 풀린다. */
    @Test
    void 방장이_강제종료하면_정산없이_GAME_ABORTED가_배포된다() {
        givenRoomWithHost();
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s1", 1L, "12345", null, now - 5_000, now + 60_000,
                        GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0)));
        when(sessionRepository.tryAcquireEndGuard(ROOM_ID, "s1", 0)).thenReturn(true);

        service.abort(ROOM_ID, host);

        verify(sessionRepository).markEnded(ROOM_ID);
        verify(liveRoomService).changeStatus(ROOM_ID, "WAITING");
        verify(eventPublisher, never()).publishEvent(any());
        verify(messagingTemplate).convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        assertThat(eventCaptor.getValue().type()).isEqualTo(GameEventResponse.EventType.GAME_ABORTED);
        assertThat(eventCaptor.getValue().sessionId()).isEqualTo("s1");
    }

    @Test
    void 중복_제출은_무시되고_브로드캐스트도_없다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s1", 1L, "orion", null, now - 5_000, now + 25_000,
                        GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0)));
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), any())).thenReturn(false);

        service.finish(ROOM_ID, new GameFinishRequest(95, null, 2), member);

        verify(messagingTemplate, never()).convertAndSend(eq(GAME_TOPIC), any(GameEventResponse.class));
    }

    /** 게임① 60초 매치: 총점은 완성 개수×100 상한으로, 완성 개수는 이론상 최대치로 클램프된다. */
    @Test
    void 게임1_총점은_완성_개수_상한으로_클램프되어_기록된다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s1", 1L, "12345", null, now - 5_000, now + 25_000,
                        GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0)));
        ArgumentCaptor<GamePlayerScore> scoreCaptor = ArgumentCaptor.forClass(GamePlayerScore.class);
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), scoreCaptor.capture())).thenReturn(true);
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 0)));
        when(sessionRepository.countScores(ROOM_ID)).thenReturn(1L);

        // 완성 2개인데 총점 999 주장 — 2×100 = 200으로 클램프
        service.finish(ROOM_ID, new GameFinishRequest(999, null, 2), member);

        assertThat(scoreCaptor.getValue().score()).isEqualTo(200);
        assertThat(scoreCaptor.getValue().completedCount()).isEqualTo(2);
    }

    /** 게임① 60초 매치: 완성 개수 없이 총점만 주장하면 0점으로 잘린다(무완성 위조 차단). */
    @Test
    void 게임1_완성_개수가_없으면_총점도_0으로_잘린다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s1", 1L, "12345", null, now - 5_000, now + 25_000,
                        GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0)));
        ArgumentCaptor<GamePlayerScore> scoreCaptor = ArgumentCaptor.forClass(GamePlayerScore.class);
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), scoreCaptor.capture())).thenReturn(true);
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 0)));
        when(sessionRepository.countScores(ROOM_ID)).thenReturn(1L);

        service.finish(ROOM_ID, new GameFinishRequest(300, null, null), member);

        assertThat(scoreCaptor.getValue().score()).isZero();
        assertThat(scoreCaptor.getValue().completedCount()).isZero();
    }

    /**
     * 게임⑤ 낚시(-49): 점수가 누적 합계라 단판 상한(100)이 아니라 "마리 수 × 어종 최고점(120)"으로
     * 클램프된다. 100에 걸리면 잘 낚은 사람과 못 낚은 사람이 전부 100점 동점이 된다.
     */
    @Test
    void 낚시_총점은_마리수_상한으로_클램프되고_100에_걸리지_않는다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s1", 11L, null, null, now - 5_000, now + 25_000,
                        GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0)));
        ArgumentCaptor<GamePlayerScore> scoreCaptor = ArgumentCaptor.forClass(GamePlayerScore.class);
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), scoreCaptor.capture())).thenReturn(true);
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 0)));
        when(sessionRepository.countScores(ROOM_ID)).thenReturn(1L);

        // 3마리로 240점(상어 2 + 광어 1 등) — 단판 상한 100에 걸리지 않고 그대로 기록된다
        service.finish(ROOM_ID, new GameFinishRequest(240, null, 3), member);

        assertThat(scoreCaptor.getValue().score()).isEqualTo(240);
        // 마리 수는 completedCount가 아니라 caught에 둔다 — 순위가 마리 수로 갈리면 안 된다
        assertThat(scoreCaptor.getValue().completedCount()).isZero();
        assertThat(scoreCaptor.getValue().stats()).containsEntry("caught", 3);
    }

    /** 게임⑤ 낚시: 3마리를 주장하며 400점을 보내면 3×120=360으로 잘린다(점수 위조 차단). */
    @Test
    void 낚시_총점은_마리수_곱_어종최고점을_넘지_못한다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s1", 11L, null, null, now - 5_000, now + 25_000,
                        GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0)));
        ArgumentCaptor<GamePlayerScore> scoreCaptor = ArgumentCaptor.forClass(GamePlayerScore.class);
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), scoreCaptor.capture())).thenReturn(true);
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 0)));
        when(sessionRepository.countScores(ROOM_ID)).thenReturn(1L);

        service.finish(ROOM_ID, new GameFinishRequest(400, null, 3), member);

        assertThat(scoreCaptor.getValue().score()).isEqualTo(360);
    }

    /**
     * 게임⑤ 낚시 순위는 <b>총점</b>으로 매긴다 — 마리 수가 1순위가 되면 상어 1마리(120점)가
     * 멸치 3마리(15점)에게 져서 "깊은 층을 노리는" 게임이 성립하지 않는다.
     */
    @Test
    void 낚시_순위는_마리수가_아니라_총점으로_매긴다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(endTaskCaptor.capture(), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        when(gameRepository.findById(11L)).thenReturn(Optional.of(Game.builder()
                .id(11L).name("모션 낚시").roundDurationSec(90).countdownSec(3).active(true).build()));

        service.start(ROOM_ID, new GameStartRequest(11L, null, null, null, null), host);
        runPrepareTimeout();
        verify(messagingTemplate, org.mockito.Mockito.times(2))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        String sessionId = eventCaptor.getValue().sessionId();

        when(sessionRepository.tryAcquireEndGuard(ROOM_ID, sessionId, 0)).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession(sessionId, 11L, null, null, 0, 1,
                        GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0)));
        // A: 3마리 15점(멸치만) / B: 1마리 120점(상어) — 마리 수 기준이면 A가 1등이 된다
        when(sessionRepository.findScores(ROOM_ID)).thenReturn(Map.of(
                "1", new GamePlayerScore("1", "A", 15, Map.of("caught", 3), 1000),
                "2", new GamePlayerScore("2", "B", 120, Map.of("caught", 1), 1100)));
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "A", false, 0),
                new LiveRoomMemberValue("2", "B", false, 0)));

        endTaskCaptor.getValue().run();

        verify(messagingTemplate, org.mockito.Mockito.times(3))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse end = eventCaptor.getValue();
        assertThat(end.results()).extracting(r -> r.userId()).containsExactly("2", "1");
        assertThat(end.results().get(0).score()).isEqualTo(120);
    }

    /** 게임④(-9): 출제자는 이번 라운드에 플레이하지 않는다 — finish를 보내도 조용히 무시된다. */
    @Test
    void 출제자의_finish_제출은_무시된다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), any())).thenReturn(true);
        long now = System.currentTimeMillis();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession("s4", 4L, "[[0.5,0.5,1]]", "1", now - 1_000, now + 5_000,
                        GameSession.STATUS_PLAYING, List.of("1", "2"), 0, "easy", null, 0)));

        service.finish(ROOM_ID, new GameFinishRequest(90, 0, null), host);

        verify(sessionRepository, never()).saveScoreIfAbsent(any(), any());
        verify(messagingTemplate, never()).convertAndSend(eq(GAME_TOPIC), any(GameEventResponse.class));
    }

    @Test
    void 시간이_되면_미제출자를_0점으로_포함해_순위를_배포한다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(endTaskCaptor.capture(), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        givenGame1();

        service.start(ROOM_ID, new GameStartRequest(1L, null, null, null, null), host);
        runPrepareTimeout();
        verify(messagingTemplate, org.mockito.Mockito.times(2))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        String sessionId = eventCaptor.getValue().sessionId();

        // 매치 종료 시각 도달 — 예약된 정산 실행
        when(sessionRepository.tryAcquireEndGuard(ROOM_ID, sessionId, 0)).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession(sessionId, 1L, "12345", null, 0, 1,
                        GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0)));
        when(sessionRepository.findScores(ROOM_ID)).thenReturn(Map.of(
                "2", new GamePlayerScore("2", "참가자", 88, Map.of("completedCount", 1), 1000)));
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 0)));

        endTaskCaptor.getValue().run();

        verify(sessionRepository).markEnded(ROOM_ID);
        verify(liveRoomService).changeStatus(ROOM_ID, "WAITING");
        // GAME_PREPARE + GAME_START + GAME_END
        verify(messagingTemplate, org.mockito.Mockito.times(3))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse end = eventCaptor.getValue();
        assertThat(end.type()).isEqualTo(GameEventResponse.EventType.GAME_END);
        assertThat(end.results()).hasSize(2);
        assertThat(end.results().get(0).userId()).isEqualTo("2");
        assertThat(end.results().get(0).rank()).isEqualTo(1);
        assertThat(end.results().get(0).score()).isEqualTo(88);
        assertThat(end.results().get(0).completedCount()).isEqualTo(1);
        assertThat(end.results().get(1).userId()).isEqualTo("1");
        assertThat(end.results().get(1).finished()).isFalse();
        assertThat(end.results().get(1).score()).isZero();
        // 획득 포인트(-83): 1등(88점, 2인 참가) = (2-1+1)*10 + 88/10 = 28
        assertThat(end.results().get(0).pointsEarned()).isEqualTo(28);
    }

    /** 게임① 60초 매치 순위(개선안): 완성 개수가 1순위, 개수가 같으면 총점(=평균)이 2순위. */
    @Test
    void 게임1_순위는_완성_개수_우선이고_동수면_총점으로_가른다() {
        givenRoomWithHost();
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(gameTaskScheduler.schedule(endTaskCaptor.capture(), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
        givenGame1();

        service.start(ROOM_ID, new GameStartRequest(1L, null, null, null, null), host);
        runPrepareTimeout();
        verify(messagingTemplate, org.mockito.Mockito.times(2))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        String sessionId = eventCaptor.getValue().sessionId();

        when(sessionRepository.tryAcquireEndGuard(ROOM_ID, sessionId, 0)).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession(sessionId, 1L, "12345", null, 0, 1,
                        GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0)));
        // A: 2개·총 120 / B: 1개·총 200(총점은 최고지만 개수 열세) / C: 2개·총 150
        when(sessionRepository.findScores(ROOM_ID)).thenReturn(Map.of(
                "1", new GamePlayerScore("1", "A", 120, Map.of("completedCount", 2), 1000),
                "2", new GamePlayerScore("2", "B", 200, Map.of("completedCount", 1), 900),
                "3", new GamePlayerScore("3", "C", 150, Map.of("completedCount", 2), 1100)));
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "A", false, 0),
                new LiveRoomMemberValue("2", "B", false, 0),
                new LiveRoomMemberValue("3", "C", false, 0)));

        endTaskCaptor.getValue().run();

        verify(messagingTemplate, org.mockito.Mockito.times(3))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse end = eventCaptor.getValue();
        assertThat(end.results()).extracting(r -> r.userId()).containsExactly("3", "1", "2");
        assertThat(end.results().get(0).completedCount()).isEqualTo(2);
        assertThat(end.results().get(2).score()).isEqualTo(200); // 총점 1위여도 개수 열세면 꼴찌
    }

    /** 게임④ 로테이션(-48): 라운드 1이 끝나면 GAME_END가 아니라 다음 출제자로 GAME_START가 다시 열린다. */
    @Test
    void 로테이션_라운드가_끝나면_다음_출제자로_새_라운드가_열린다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(ROOM_ID, "2")).thenReturn(true);
        long now = System.currentTimeMillis();
        String sessionId = "s4";
        when(sessionRepository.tryAcquireEndGuard(ROOM_ID, sessionId, 0)).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession(sessionId, 4L, "[[0.5,0.5,1]]", "1", now - 12_000, now + 5_000,
                        GameSession.STATUS_PLAYING, List.of("1", "2"), 0, "easy", null, 0)));
        when(sessionRepository.findScores(ROOM_ID)).thenReturn(Map.of(
                "2", new GamePlayerScore("2", "참가자", 70, Map.of(), 1000)));
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), any())).thenReturn(true);
        when(sessionRepository.countScores(ROOM_ID)).thenReturn(1L);
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 0)));
        when(gameTaskScheduler.schedule(any(Runnable.class), any(Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));

        service.finish(ROOM_ID, new GameFinishRequest(70, 0, null), member);

        verify(sessionRepository).addToTotal(ROOM_ID, "2", 70);
        verify(sessionRepository, never()).markEnded(any());
        verify(liveRoomService, never()).changeStatus(eq(ROOM_ID), eq("WAITING"));
        ArgumentCaptor<GameSession> savedCaptor = ArgumentCaptor.forClass(GameSession.class);
        verify(sessionRepository).saveSession(eq(ROOM_ID), savedCaptor.capture());
        assertThat(savedCaptor.getValue().roundIndex()).isEqualTo(1);
        assertThat(savedCaptor.getValue().setterUserId()).isEqualTo("2");
        // GAME_START(1라운드) mock 없음 — finish 흐름만 검증하므로 PLAYER_FINISHED + 다음 GAME_START 2회
        verify(messagingTemplate, org.mockito.Mockito.times(2))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse nextStart = eventCaptor.getValue();
        assertThat(nextStart.type()).isEqualTo(GameEventResponse.EventType.GAME_START);
        assertThat(nextStart.setterUserId()).isEqualTo("2");
        assertThat(nextStart.roundNo()).isEqualTo(2);
        assertThat(nextStart.totalRounds()).isEqualTo(2);
    }

    /** 게임④ 로테이션(-48): 마지막 참가자까지 출제를 마치면 누적 점수로 GAME_END가 배포된다. */
    @Test
    void 마지막_라운드가_끝나면_누적_점수로_GAME_END를_배포한다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(ROOM_ID, "1")).thenReturn(true);
        long now = System.currentTimeMillis();
        String sessionId = "s4";
        when(sessionRepository.tryAcquireEndGuard(ROOM_ID, sessionId, 1)).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(
                new GameSession(sessionId, 4L, "[[0.5,0.5,1]]", "2", now - 12_000, now + 5_000,
                        GameSession.STATUS_PLAYING, List.of("1", "2"), 1, "easy", null, 0)));
        when(sessionRepository.findScores(ROOM_ID)).thenReturn(Map.of(
                "1", new GamePlayerScore("1", "방장", 90, Map.of(), 1000)));
        when(sessionRepository.findTotals(ROOM_ID)).thenReturn(Map.of("1", 90, "2", 70));
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), any())).thenReturn(true);
        when(sessionRepository.countScores(ROOM_ID)).thenReturn(1L);
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue("1", "방장", false, 0),
                new LiveRoomMemberValue("2", "참가자", false, 0)));

        service.finish(ROOM_ID, new GameFinishRequest(90, 0, null), host);

        verify(sessionRepository).addToTotal(ROOM_ID, "1", 90);
        verify(sessionRepository).markEnded(ROOM_ID);
        verify(liveRoomService).changeStatus(ROOM_ID, "WAITING");
        verify(messagingTemplate, org.mockito.Mockito.times(2))
                .convertAndSend(eq(GAME_TOPIC), eventCaptor.capture());
        GameEventResponse end = eventCaptor.getValue();
        assertThat(end.type()).isEqualTo(GameEventResponse.EventType.GAME_END);
        assertThat(end.results()).hasSize(2);
        assertThat(end.results().get(0).userId()).isEqualTo("1");
        assertThat(end.results().get(0).score()).isEqualTo(90);
        assertThat(end.results().get(1).userId()).isEqualTo("2");
        assertThat(end.results().get(1).score()).isEqualTo(70);
    }
}
