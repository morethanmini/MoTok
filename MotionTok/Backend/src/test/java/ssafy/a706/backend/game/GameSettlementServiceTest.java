package ssafy.a706.backend.game;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ssafy.a706.backend.game.dto.GameResultEntry;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.entity.LeaderboardWeekly;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.repository.LeaderboardRepository;
import ssafy.a706.backend.game.repository.LeaderboardWeeklyRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 게임 결과 정산(S15P11A706-117) 단위 테스트 — 회원 필터링 / 최고점 upsert / 주간 합산 / 중복 가드.
 * (pointsEarned는 정산에 쓰이지 않아 임의값 0으로 둔다.)
 */
@ExtendWith(MockitoExtension.class)
class GameSettlementServiceTest {

    private static final String SESSION = "sess-1";
    private static final long GAME = 1L;
    private static final LeaderboardMode MODE = LeaderboardMode.MULTI;

    @Mock LeaderboardRepository leaderboardRepository;
    @Mock LeaderboardWeeklyRepository weeklyRepository;
    @InjectMocks GameSettlementService service;

    private GameResultEntry result(String userId, int score) {
        return new GameResultEntry(1, userId, "닉", score, 5, true, 0, null);
    }

    private void givenNoExistingRows() {
        when(leaderboardRepository.findByGameIdAndUserIdAndMode(anyLong(), anyLong(), any()))
                .thenReturn(Optional.empty());
        when(weeklyRepository.findByGameIdAndUserIdAndModeAndWeekStart(anyLong(), anyLong(), any(), any()))
                .thenReturn(Optional.empty());
    }

    @Test
    void 회원만_적재하고_게스트는_제외한다() {
        givenNoExistingRows();

        int members = service.settleToDb(SESSION, GAME, MODE, List.of(
                result("2", 88),
                result("guest-ab12", 50)));

        // 게스트("guest-ab12")는 숫자 파싱 실패 → 제외, 회원("2")만 적재
        assertThat(members).isEqualTo(1);
        verify(leaderboardRepository, times(1)).save(any());
        verify(weeklyRepository, times(1)).save(any());
    }

    @Test
    void 기존보다_높은_점수면_최고점_갱신하고_플레이수_증가() {
        Leaderboard existing = new Leaderboard(GAME, 2L, MODE);
        existing.record(70); // best 70, play 1
        when(leaderboardRepository.findByGameIdAndUserIdAndMode(GAME, 2L, MODE)).thenReturn(Optional.of(existing));
        when(weeklyRepository.findByGameIdAndUserIdAndModeAndWeekStart(anyLong(), anyLong(), any(), any()))
                .thenReturn(Optional.empty());

        service.settleToDb(SESSION, GAME, MODE, List.of(result("2", 88)));

        assertThat(existing.getBestScore()).isEqualTo(88);
        assertThat(existing.getPlayCount()).isEqualTo(2);
    }

    @Test
    void 낮은_점수는_최고점을_낮추지_않는다() {
        Leaderboard existing = new Leaderboard(GAME, 2L, MODE);
        existing.record(90);
        when(leaderboardRepository.findByGameIdAndUserIdAndMode(GAME, 2L, MODE)).thenReturn(Optional.of(existing));
        when(weeklyRepository.findByGameIdAndUserIdAndModeAndWeekStart(anyLong(), anyLong(), any(), any()))
                .thenReturn(Optional.empty());

        service.settleToDb(SESSION, GAME, MODE, List.of(result("2", 40)));

        assertThat(existing.getBestScore()).isEqualTo(90); // 유지
        assertThat(existing.getPlayCount()).isEqualTo(2);
    }

    /** 주간은 최고점과 달리 <b>더한다</b> — 낮은 점수도 합계에는 들어간다. */
    @Test
    void 주간은_점수를_합산한다() {
        LeaderboardWeekly weekly = new LeaderboardWeekly(GAME, 2L, MODE, LocalDate.of(2026, 8, 3));
        weekly.record("이전-세션", 500);
        when(leaderboardRepository.findByGameIdAndUserIdAndMode(GAME, 2L, MODE)).thenReturn(Optional.empty());
        when(weeklyRepository.findByGameIdAndUserIdAndModeAndWeekStart(anyLong(), anyLong(), any(), any()))
                .thenReturn(Optional.of(weekly));

        service.settleToDb(SESSION, GAME, MODE, List.of(result("2", 300)));

        assertThat(weekly.getScoreSum()).isEqualTo(800);
        assertThat(weekly.getPlayCount()).isEqualTo(2);
    }

    /**
     * 같은 세션이 두 번 정산되면 <b>그 회원 몫을 통째로</b> 건너뛴다.
     *
     * <p>최고점(GREATEST)만 보면 두 번 반영해도 값이 같아 안전해 보이지만, play_count와 주간 합계는
     * 그렇지 않다. 가드를 세 값에 따로 두는 대신 진입점 한 곳에 둔다.</p>
     */
    @Test
    void 같은_세션_재정산은_최고점도_주간도_건드리지_않는다() {
        LeaderboardWeekly weekly = new LeaderboardWeekly(GAME, 2L, MODE, LocalDate.of(2026, 8, 3));
        weekly.record(SESSION, 300); // 이미 이 세션으로 합산됨
        when(weeklyRepository.findByGameIdAndUserIdAndModeAndWeekStart(anyLong(), anyLong(), any(), any()))
                .thenReturn(Optional.of(weekly));

        int members = service.settleToDb(SESSION, GAME, MODE, List.of(result("2", 300)));

        assertThat(members).isZero();
        assertThat(weekly.getScoreSum()).isEqualTo(300); // 600이 되지 않는다
        assertThat(weekly.getPlayCount()).isEqualTo(1);
        verify(leaderboardRepository, never()).save(any());
        verify(weeklyRepository, never()).save(any());
    }
}
