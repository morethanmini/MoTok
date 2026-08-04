package ssafy.a706.backend.game;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.game.dto.GameSummaryResponse;
import ssafy.a706.backend.game.dto.LeaderboardResponse;
import ssafy.a706.backend.game.dto.LeaderboardRow;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.model.LeaderboardPeriod;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.game.repository.LeaderboardRepository;
import ssafy.a706.backend.game.repository.LeaderboardWeeklyRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 게임 카탈로그·리더보드 조회(-28·-96) 단위 테스트.
 * 시나리오: 404 / 순위 번호 매김(동점 분리 포함) / myRank 분기 / 기간(전체·주간) 라우팅.
 *
 * <p>정렬·동점 tie-break·탈퇴 제외는 이제 <b>JPQL이 한다</b>(LeaderboardRepository). 목으로는
 * 검증할 수 없으므로 여기서는 "쿼리가 준 순서를 그대로 순위로 매기는가"까지만 본다.</p>
 */
@ExtendWith(MockitoExtension.class)
class GameQueryServiceTest {

    private static final long GAME_ID = 1L;
    private static final LeaderboardMode MODE = LeaderboardMode.MULTI;
    private static final LocalDateTime T0 = LocalDateTime.of(2026, 8, 1, 12, 0);

    @Mock GameRepository gameRepository;
    @Mock LeaderboardRepository leaderboardRepository;
    @Mock LeaderboardWeeklyRepository weeklyRepository;

    @InjectMocks GameQueryService service;

    private LeaderboardRow row(long userId, String nickname, long score, int plays, int minuteOffset) {
        return new LeaderboardRow(userId, nickname, null, score, plays, T0.plusMinutes(minuteOffset));
    }

    private Game game(long id, String name, int minPlayers) {
        return game(id, name, minPlayers, "VERSUS");
    }

    private Game game(long id, String name, int minPlayers, String mode) {
        return Game.builder().id(id).name(name).mode(mode)
                .minPlayers(minPlayers).maxPlayers(8)
                .roundDurationSec(30).countdownSec(3).active(true).build();
    }

    private void givenGameExists() {
        when(gameRepository.findById(GAME_ID)).thenReturn(Optional.of(game(GAME_ID, "핑거 스타", 1)));
    }

    private LeaderboardResponse allTime(int limit, AuthPrincipal principal) {
        return service.leaderboard(GAME_ID, MODE, LeaderboardPeriod.ALLTIME, null, limit, principal);
    }

    @Test
    void 게임이_없으면_GAME_NOT_FOUND() {
        when(gameRepository.findById(GAME_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> allTime(20, null))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.GAME_NOT_FOUND);
    }

    @Test
    void 상위권을_순위와_닉네임_플레이수와_함께_돌려준다() {
        givenGameExists();
        when(leaderboardRepository.findTopRows(eq(GAME_ID), eq(MODE), any(Pageable.class)))
                .thenReturn(List.of(row(10L, "별잡이", 95, 3, 0), row(11L, "민지", 80, 2, 5)));

        LeaderboardResponse response = allTime(20, null);

        assertThat(response.gameId()).isEqualTo(GAME_ID);
        assertThat(response.period()).isEqualTo(LeaderboardPeriod.ALLTIME);
        assertThat(response.weekStart()).isNull();
        assertThat(response.entries()).hasSize(2);
        assertThat(response.entries().get(0).rank()).isEqualTo(1);
        assertThat(response.entries().get(0).nickname()).isEqualTo("별잡이");
        assertThat(response.entries().get(0).score()).isEqualTo(95);
        assertThat(response.entries().get(0).playCount()).isEqualTo(3);
        assertThat(response.entries().get(0).achievedAt()).isEqualTo(T0);
        assertThat(response.entries().get(1).rank()).isEqualTo(2);
        assertThat(response.myRank()).isNull(); // 비로그인
    }

    /**
     * 게임이니까 1·2·3등은 무조건 갈린다 — 동점이라고 같은 번호를 주고 다음을 건너뛰지 않는다.
     * 누가 위인지는 쿼리가 정한다(먼저 달성한 사람). 여기서는 번호를 나눠 매기는지만 본다.
     */
    @Test
    void 동점이어도_순위를_나눠_매긴다() {
        givenGameExists();
        when(leaderboardRepository.findTopRows(eq(GAME_ID), eq(MODE), any(Pageable.class)))
                .thenReturn(List.of(
                        row(10L, "먼저", 90, 1, 0),
                        row(11L, "나중", 90, 1, 30),
                        row(12L, "셋째", 70, 1, 60)));

        LeaderboardResponse response = allTime(20, null);

        assertThat(response.entries()).extracting(e -> e.rank()).containsExactly(1, 2, 3);
        assertThat(response.entries()).extracting(e -> e.nickname()).containsExactly("먼저", "나중", "셋째");
    }

    @Test
    void 조회_건수는_limit으로_잘라_요청한다() {
        givenGameExists();
        when(leaderboardRepository.findTopRows(eq(GAME_ID), eq(MODE), any(Pageable.class)))
                .thenReturn(List.of());

        allTime(5, null);

        ArgumentCaptor<Pageable> page = ArgumentCaptor.forClass(Pageable.class);
        verify(leaderboardRepository).findTopRows(eq(GAME_ID), eq(MODE), page.capture());
        // 예전엔 탈퇴자에 잘려나갈 것을 감안해 여유분을 더 뽑았다. 이제 조인이 걸러 주므로 정확히 limit이다.
        assertThat(page.getValue().getPageSize()).isEqualTo(5);
    }

    @Test
    void 회원이_노출_목록_안에_있으면_myRank는_그_항목과_일치한다() {
        givenGameExists();
        when(leaderboardRepository.findTopRows(eq(GAME_ID), eq(MODE), any(Pageable.class)))
                .thenReturn(List.of(row(10L, "별잡이", 95, 3, 0)));

        LeaderboardResponse response = allTime(20, new MemberPrincipal(10L, "별잡이"));

        assertThat(response.myRank()).isEqualTo(response.entries().get(0));
        // 목록 안에 있으면 순위를 다시 세지 않는다
        verify(leaderboardRepository, never()).countAhead(anyLong(), any(), anyLong(), any(), anyLong());
    }

    @Test
    void 회원이_상위권_밖이면_앞선_사람_수_플러스_1로_myRank를_채운다() {
        givenGameExists();
        when(leaderboardRepository.findTopRows(eq(GAME_ID), eq(MODE), any(Pageable.class)))
                .thenReturn(List.of(row(10L, "별잡이", 95, 1, 0)));
        LeaderboardRow mine = row(99L, "나", 40, 5, 90);
        when(leaderboardRepository.findRow(GAME_ID, MODE, 99L)).thenReturn(Optional.of(mine));
        when(leaderboardRepository.countAhead(GAME_ID, MODE, 40L, mine.achievedAt(), 99L)).thenReturn(7L);

        LeaderboardResponse response = allTime(1, new MemberPrincipal(99L, "나"));

        assertThat(response.myRank()).isNotNull();
        assertThat(response.myRank().rank()).isEqualTo(8); // 앞선 7명 → 8위
        assertThat(response.myRank().score()).isEqualTo(40);
        assertThat(response.myRank().playCount()).isEqualTo(5);
    }

    @Test
    void 게스트나_기록_없는_회원은_myRank가_null이다() {
        givenGameExists();
        when(leaderboardRepository.findTopRows(eq(GAME_ID), eq(MODE), any(Pageable.class)))
                .thenReturn(List.of(row(10L, "별잡이", 95, 1, 0)));

        AuthPrincipal guest = mock(AuthPrincipal.class);
        assertThat(allTime(20, guest).myRank()).isNull();

        when(leaderboardRepository.findRow(GAME_ID, MODE, 99L)).thenReturn(Optional.empty());
        assertThat(allTime(20, new MemberPrincipal(99L, "신규")).myRank()).isNull();
    }

    /** 주간 탭은 주간 테이블을 본다 — 전체기간 쪽은 건드리지 않아야 두 랭킹이 섞이지 않는다. */
    @Test
    void 주간이면_주간_리포지토리를_보고_집계한_주를_알려준다() {
        givenGameExists();
        when(weeklyRepository.findTopRows(eq(GAME_ID), eq(MODE), eq(LocalDate.of(2026, 8, 3)), any(Pageable.class)))
                .thenReturn(List.of(row(10L, "별잡이", 4200, 12, 0)));

        // 2026-08-05는 수요일 — 그 주 월요일(08-03)로 스냅된다
        LeaderboardResponse response = service.leaderboard(
                GAME_ID, MODE, LeaderboardPeriod.WEEKLY, LocalDate.of(2026, 8, 5), 20, null);

        assertThat(response.period()).isEqualTo(LeaderboardPeriod.WEEKLY);
        assertThat(response.weekStart()).isEqualTo(LocalDate.of(2026, 8, 3));
        assertThat(response.entries().get(0).score()).isEqualTo(4200);
        verifyNoInteractions(leaderboardRepository);
    }

    /**
     * 혼자 시작할 수 없는 게임(minPlayers ≥ 2)에 솔로 순위표는 없다.
     *
     * <p>정산이 참가 인원으로 모드를 정하니 새로 쌓이지는 않지만, 개발 중 최소 인원을 잠깐 풀고
     * 테스트한 기록이 남아 있다. 막지 않으면 "3명부터"라는 규칙 안내와 순위표가 서로 어긋난다.</p>
     */
    @Test
    void 혼자_할_수_없는_게임의_솔로_순위표는_비어_있다() {
        when(gameRepository.findById(GAME_ID)).thenReturn(Optional.of(game(GAME_ID, "그림으로 말해요", 3)));

        LeaderboardResponse response = service.leaderboard(
                GAME_ID, LeaderboardMode.SOLO, LeaderboardPeriod.ALLTIME, null, 20,
                new MemberPrincipal(10L, "나"));

        assertThat(response.entries()).isEmpty();
        assertThat(response.myRank()).isNull();
        // 남은 기록을 읽지도 않는다 — 비어 있는 건 조회 결과가 아니라 규칙이다
        verifyNoInteractions(leaderboardRepository, weeklyRepository);
    }

    /**
     * 협동 게임(그림으로 말해요)에 역대 최고점 순위표는 없다.
     *
     * <p>협동은 전원이 같은 점수를 받고({@code GameSessionService.coopResults}), 그 점수도 AI 추측
     * 순위에 따른 여섯 값(100·80·60·40·20·0)뿐이다({@code DrawJudge.scoreForRank}). 그래서 역대
     * 최고점은 사람이 조금만 늘어도 전부 100점에 몰려 "100점을 제일 먼저 겪은 사람"으로 굳는다 —
     * 게다가 그건 개인 실력이 아니라 그날 팀의 결과다.</p>
     */
    @Test
    void 협동_게임의_역대_순위표는_비어_있다() {
        when(gameRepository.findById(GAME_ID))
                .thenReturn(Optional.of(game(GAME_ID, "그림으로 말해요", 3, "COOP")));

        LeaderboardResponse response = allTime(20, new MemberPrincipal(10L, "나"));

        assertThat(response.entries()).isEmpty();
        assertThat(response.myRank()).isNull();
        verifyNoInteractions(leaderboardRepository, weeklyRepository);
    }

    /** 막는 건 역대뿐 — 협동에서도 주간 누적은 합계라 값이 흩어지고 매주 리셋되므로 성립한다. */
    @Test
    void 협동_게임도_주간_순위표는_그대로_준다() {
        when(gameRepository.findById(GAME_ID))
                .thenReturn(Optional.of(game(GAME_ID, "그림으로 말해요", 3, "COOP")));
        when(weeklyRepository.findTopRows(eq(GAME_ID), eq(MODE), any(LocalDate.class), any(Pageable.class)))
                .thenReturn(List.of(row(10L, "그림왕", 340, 5, 0)));

        LeaderboardResponse response = service.leaderboard(
                GAME_ID, MODE, LeaderboardPeriod.WEEKLY, LocalDate.of(2026, 8, 5), 20, null);

        assertThat(response.entries()).hasSize(1);
        assertThat(response.entries().get(0).score()).isEqualTo(340);
    }

    /** 막는 건 솔로뿐 — 같은 게임의 멀티 순위표는 그대로 나와야 한다. */
    @Test
    void 혼자_할_수_없는_게임도_멀티_순위표는_그대로_준다() {
        when(gameRepository.findById(GAME_ID)).thenReturn(Optional.of(game(GAME_ID, "그림으로 말해요", 3)));
        when(leaderboardRepository.findTopRows(eq(GAME_ID), eq(MODE), any(Pageable.class)))
                .thenReturn(List.of(row(10L, "그림왕", 95, 2, 0)));

        LeaderboardResponse response = allTime(20, null);

        assertThat(response.entries()).hasSize(1);
        assertThat(response.entries().get(0).nickname()).isEqualTo("그림왕");
    }

    /**
     * 관리자가 닫은 게임(-106)은 목록에서 <b>사라지지 않는다</b>. 지워 버리면 어제까지 있던 게임이
     * 흔적 없이 없어져 사용자가 이유를 알 수 없다 — 대신 playable=false로 잠긴 카드가 된다.
     */
    @Test
    void 목록은_닫힌_게임도_담고_playable로_구분한다() {
        Game open = Game.builder()
                .id(1L).name("핑거 스타").mode("VERSUS").minPlayers(1).maxPlayers(8)
                .roundDurationSec(30).countdownSec(3).active(true).build();
        Game closed = Game.builder()
                .id(2L).name("점검 중 게임").minPlayers(1).maxPlayers(8)
                .roundDurationSec(30).countdownSec(3).active(false).build();
        when(gameRepository.findAll(any(Sort.class))).thenReturn(List.of(open, closed));

        List<GameSummaryResponse> all = service.list(null);
        assertThat(all).hasSize(2);
        assertThat(all.get(0).name()).isEqualTo("핑거 스타");
        assertThat(all.get(0).playable()).isTrue();
        assertThat(all.get(0).active()).isTrue();
        // 닫힌 게임은 인원과 무관하게 시작할 수 없다 — active와 playable이 함께 false여야
        // 화면이 "점검 중"과 "인원 부족"을 구분해 안내할 수 있다.
        assertThat(all.get(1).name()).isEqualTo("점검 중 게임");
        assertThat(all.get(1).playable()).isFalse();
        assertThat(all.get(1).active()).isFalse();

        List<GameSummaryResponse> tooMany = service.list(10);
        assertThat(tooMany.get(0).playable()).isFalse(); // 정원 8 초과 인원
        assertThat(tooMany.get(0).active()).isTrue();    // 닫힌 건 아니다
    }

    /**
     * 목록은 <b>id 순으로 정렬해</b> 조회한다. 정렬 없는 {@code findAll()}은 SQL이 순서를 보장하지
     * 않아 실행 계획이 바뀌면 조회마다 순서가 달라질 수 있고, 화면은 이 목록을 게임 id를 key로 하는
     * 카드 그리드로 그리므로 같은 목록인데도 카드가 재정렬되며 튄다.
     */
    @Test
    void 목록은_id_오름차순으로_조회한다() {
        when(gameRepository.findAll(any(Sort.class))).thenReturn(List.of());

        service.list(null);

        ArgumentCaptor<Sort> sort = ArgumentCaptor.forClass(Sort.class);
        verify(gameRepository).findAll(sort.capture());
        assertThat(sort.getValue()).isEqualTo(Sort.by(Sort.Direction.ASC, "id"));
    }

    /** 목록에 남아 눌릴 수 있는 카드라 상세도 열려야 한다 — 404면 화면이 앞뒤가 안 맞는다. */
    @Test
    void 닫힌_게임도_상세는_조회된다() {
        Game closed = Game.builder()
                .id(2L).name("점검 중 게임").minPlayers(1).maxPlayers(8)
                .roundDurationSec(30).countdownSec(3).active(false).build();
        when(gameRepository.findById(2L)).thenReturn(Optional.of(closed));

        assertThat(service.detail(2L).name()).isEqualTo("점검 중 게임");
    }

    @Test
    void 없는_게임_상세는_GAME_NOT_FOUND() {
        when(gameRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.detail(99L))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.GAME_NOT_FOUND);
    }
}
