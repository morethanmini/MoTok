package ssafy.a706.backend.rhythm;

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
import ssafy.a706.backend.game.GameSettledEvent;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.rhythm.dto.RhythmEventResponse;
import ssafy.a706.backend.rhythm.dto.RhythmRequests;
import ssafy.a706.backend.rhythm.model.RhythmPlayerScore;
import ssafy.a706.backend.rhythm.model.RhythmSession;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ScheduledFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 캐치캐치리듬 세션 서버 단위 테스트 — Redis·브로커 없이 순수 로직만 본다.
 * 시나리오: 방장 검증 / 시드 배포 / 난이도 폴백 / 점수 클램프 / 제출 멱등 / 순위·포인트 정산.
 */
@ExtendWith(MockitoExtension.class)
class RhythmSessionServiceTest {

    private static final String ROOM_ID = "R1AB2C";
    private static final String TOPIC = "/topic/rooms/" + ROOM_ID + "/rhythm";

    @Mock RoomMembershipReader membershipReader;
    @Mock LiveRoomRepository liveRoomRepository;
    @Mock RhythmSessionRepository sessionRepository;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock TaskScheduler rhythmTaskScheduler;
    @Mock ApplicationEventPublisher eventPublisher;

    @InjectMocks RhythmSessionService service;

    @Captor ArgumentCaptor<RhythmEventResponse> eventCaptor;

    private final MemberPrincipal host = new MemberPrincipal(1L, "호스트");
    private final MemberPrincipal guest = new MemberPrincipal(2L, "게스트");

    // ── 헬퍼 ──────────────────────────────────────────────

    private void givenRoomWithHost() {
        when(liveRoomRepository.findRoomFields(ROOM_ID))
                .thenReturn(Optional.of(Map.of("hostUserId", host.userId())));
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), anyString())).thenReturn(true);
    }

    private void givenNoActiveSession() {
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());
        when(rhythmTaskScheduler.schedule(any(Runnable.class), any(java.time.Instant.class)))
                .thenReturn(mock(ScheduledFuture.class));
    }

    private RhythmSession playingSession() {
        long now = System.currentTimeMillis();
        return new RhythmSession("S1", 42L, "HARD", now - 1000, now + 60_000,
                RhythmSession.STATUS_PLAYING);
    }

    private RhythmEventResponse lastEvent() {
        verify(messagingTemplate, org.mockito.Mockito.atLeastOnce())
                .convertAndSend(eq(TOPIC), eventCaptor.capture());
        return eventCaptor.getValue();
    }

    // ── 시작 ──────────────────────────────────────────────

    @Test
    void 방장이_아니면_시작할_수_없다() {
        when(liveRoomRepository.findRoomFields(ROOM_ID))
                .thenReturn(Optional.of(Map.of("hostUserId", host.userId())));
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), anyString())).thenReturn(true);

        assertThatThrownBy(() -> service.start(ROOM_ID, new RhythmRequests.Start("HARD"), guest))
                .isInstanceOf(RhythmException.class)
                .hasFieldOrPropertyWithValue("code", "RHYTHM_NOT_HOST");
        verify(messagingTemplate, never()).convertAndSend(anyString(), any(Object.class));
    }

    @Test
    void 방에_없으면_시작할_수_없다() {
        when(liveRoomRepository.findRoomFields(ROOM_ID))
                .thenReturn(Optional.of(Map.of("hostUserId", host.userId())));
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), anyString())).thenReturn(false);

        assertThatThrownBy(() -> service.start(ROOM_ID, new RhythmRequests.Start("HARD"), host))
                .isInstanceOf(RhythmException.class)
                .hasFieldOrPropertyWithValue("code", "RHYTHM_NOT_IN_ROOM");
    }

    @Test
    void 시작하면_시드와_시각을_배포하고_정산을_예약한다() {
        givenRoomWithHost();
        givenNoActiveSession();

        service.start(ROOM_ID, new RhythmRequests.Start("HARD"), host);

        RhythmEventResponse event = lastEvent();
        assertThat(event.type()).isEqualTo("RHYTHM_START");
        assertThat(event.difficulty()).isEqualTo("HARD");
        // seed는 문자열이어야 한다 — long을 숫자로 내리면 JS 정밀도에서 값이 갈린다
        assertThat(event.seed()).isNotBlank();
        assertThat(Long.parseLong(event.seed())).isNotNull();
        assertThat(event.endAt() - event.startAt())
                .isEqualTo(RhythmGameSeeder.ROUND_DURATION_SEC * 1000L);
        assertThat(event.startAt() - event.serverNow())
                .isEqualTo(RhythmGameSeeder.COUNTDOWN_SEC * 1000L);

        verify(sessionRepository).saveSession(eq(ROOM_ID), any(RhythmSession.class));
        verify(liveRoomRepository).updateStatus(ROOM_ID, "PLAYING");
        verify(rhythmTaskScheduler).schedule(any(Runnable.class), any(java.time.Instant.class));
    }

    @Test
    void 알_수_없는_난이도는_NORMAL로_폴백한다() {
        givenRoomWithHost();
        givenNoActiveSession();

        service.start(ROOM_ID, new RhythmRequests.Start("IMPOSSIBLE"), host);

        assertThat(lastEvent().difficulty()).isEqualTo("NORMAL");
    }

    @Test
    void 진행_중인_라운드가_있으면_다시_시작할_수_없다() {
        when(liveRoomRepository.findRoomFields(ROOM_ID))
                .thenReturn(Optional.of(Map.of("hostUserId", host.userId())));
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), anyString())).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(playingSession()));

        assertThatThrownBy(() -> service.start(ROOM_ID, new RhythmRequests.Start("EASY"), host))
                .isInstanceOf(RhythmException.class)
                .hasFieldOrPropertyWithValue("code", "RHYTHM_ALREADY_ACTIVE");
    }

    // ── 진행·제출 ─────────────────────────────────────────

    @Test
    void 진행_점수는_상한으로_클램프된다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), anyString())).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(playingSession()));

        service.progress(ROOM_ID, new RhythmRequests.Progress(999_999_999, -5), host);

        RhythmEventResponse event = lastEvent();
        assertThat(event.type()).isEqualTo("PROGRESS");
        assertThat(event.score()).isEqualTo(91_200); // MAX_SCORE
        assertThat(event.combo()).isZero(); // 음수는 0으로
    }

    @Test
    void 라운드가_없으면_제출할_수_없다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), anyString())).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.finish(ROOM_ID,
                new RhythmRequests.Finish(100, 10, 5, 3, 1), host))
                .isInstanceOf(RhythmException.class)
                .hasFieldOrPropertyWithValue("code", "RHYTHM_SESSION_NOT_FOUND");
    }

    @Test
    void 재제출은_조용히_무시된다() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(eq(ROOM_ID), anyString())).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(playingSession()));
        when(sessionRepository.saveScoreIfAbsent(eq(ROOM_ID), any())).thenReturn(false);

        service.finish(ROOM_ID, new RhythmRequests.Finish(500, 20, 10, 5, 2), host);

        verify(messagingTemplate, never()).convertAndSend(anyString(), any(Object.class));
    }

    // ── 정산 ──────────────────────────────────────────────

    @Test
    void 정산은_미제출자를_0점으로_포함하고_점수순으로_매긴다() {
        when(sessionRepository.tryAcquireEndGuard(ROOM_ID, "S1")).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(playingSession()));
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue(host.userId(), "호스트", false, 0L),
                new LiveRoomMemberValue(guest.userId(), "게스트", false, 0L)));
        // 게스트만 제출 — 호스트는 미제출
        when(sessionRepository.findScores(ROOM_ID)).thenReturn(Map.of(
                guest.userId(),
                new RhythmPlayerScore(guest.userId(), "게스트", 8_000, 30, 60, 10, 5, 1L)));

        service.endRound(ROOM_ID, "S1");

        RhythmEventResponse event = lastEvent();
        assertThat(event.type()).isEqualTo("RHYTHM_END");
        assertThat(event.results()).hasSize(2);
        // 1등 = 제출한 게스트
        assertThat(event.results().get(0).userId()).isEqualTo(guest.userId());
        assertThat(event.results().get(0).finished()).isTrue();
        assertThat(event.results().get(0).accuracy()).isEqualTo(93); // (60+10)/75
        // 2등 = 미제출 호스트, 0점
        assertThat(event.results().get(1).userId()).isEqualTo(host.userId());
        assertThat(event.results().get(1).finished()).isFalse();
        assertThat(event.results().get(1).score()).isZero();

        verify(sessionRepository).markEnded(ROOM_ID);
        verify(liveRoomRepository).updateStatus(ROOM_ID, "WAITING");
    }

    @Test
    void 정산은_기존_리스너에_리듬_전용_포인트를_실어_위임한다() {
        when(sessionRepository.tryAcquireEndGuard(ROOM_ID, "S1")).thenReturn(true);
        when(sessionRepository.findSession(ROOM_ID)).thenReturn(Optional.of(playingSession()));
        when(liveRoomRepository.findMembers(ROOM_ID)).thenReturn(List.of(
                new LiveRoomMemberValue(host.userId(), "호스트", false, 0L)));
        when(sessionRepository.findScores(ROOM_ID)).thenReturn(Map.of(
                host.userId(),
                new RhythmPlayerScore(host.userId(), "호스트", 8_000, 30, 60, 10, 5, 1L)));

        service.endRound(ROOM_ID, "S1");

        ArgumentCaptor<GameSettledEvent> captor = ArgumentCaptor.forClass(GameSettledEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        GameSettledEvent settled = captor.getValue();
        assertThat(settled.gameId()).isEqualTo(RhythmGameSeeder.GAME_ID);
        // 1인 = 순위 보상 0, 실력 보너스만: 8000/400 = 20
        assertThat(settled.results().get(0).pointsEarned())
                .isEqualTo(RhythmPointCalculator.calc(1, 8_000, 1))
                .isEqualTo(20);
        // starsHit 자리에는 최대 콤보를 싣는다
        assertThat(settled.results().get(0).starsHit()).isEqualTo(30);
    }

    @Test
    void 가드를_못_잡으면_정산하지_않는다() {
        when(sessionRepository.tryAcquireEndGuard(ROOM_ID, "S1")).thenReturn(false);

        service.endRound(ROOM_ID, "S1");

        verify(messagingTemplate, never()).convertAndSend(anyString(), any(Object.class));
        verify(eventPublisher, never()).publishEvent(any(GameSettledEvent.class));
    }

    @Test
    void 포인트는_실력과_순위를_비슷한_무게로_준다() {
        // HARD 전퍼펙트(~19,000) 8인 1등
        assertThat(RhythmPointCalculator.calc(1, 19_000, 8)).isEqualTo(48 + 70);
        // 꼴찌는 순위 보상 없음
        assertThat(RhythmPointCalculator.calc(8, 19_000, 8)).isEqualTo(48);
        // 미제출 0점
        assertThat(RhythmPointCalculator.calc(8, 0, 8)).isZero();
    }
}
