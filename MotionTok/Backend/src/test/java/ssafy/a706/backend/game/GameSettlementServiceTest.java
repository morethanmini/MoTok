package ssafy.a706.backend.game;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ssafy.a706.backend.game.dto.GameResultEntry;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.repository.LeaderboardRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 게임 결과 정산(S15P11A706-117) 단위 테스트 — 회원 필터링·최고점 upsert 로직.
 * (pointsEarned는 정산에 쓰이지 않아 임의값 0으로 둔다.)
 */
@ExtendWith(MockitoExtension.class)
class GameSettlementServiceTest {

    @Mock LeaderboardRepository leaderboardRepository;
    @InjectMocks GameSettlementService service;

    @Test
    void 회원만_적재하고_게스트는_제외한다() {
        when(leaderboardRepository.findByGameIdAndUserIdAndMode(1L, 2L, LeaderboardMode.MULTI)).thenReturn(Optional.empty());
        when(leaderboardRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        Map<Long, Integer> best = service.settleToDb(1L, LeaderboardMode.MULTI, List.of(
                new GameResultEntry(1, "2", "회원", 88, 5, true, 0),
                new GameResultEntry(2, "guest-ab12", "게스트", 50, 3, true, 0)));

        // 게스트("guest-ab12")는 숫자 파싱 실패 → 제외, 회원("2")만 적재
        assertThat(best).containsOnlyKeys(2L);
        assertThat(best.get(2L)).isEqualTo(88);
        verify(leaderboardRepository, times(1)).save(any());
    }

    @Test
    void 기존보다_높은_점수면_최고점_갱신하고_플레이수_증가() {
        Leaderboard existing = new Leaderboard(1L, 2L, LeaderboardMode.MULTI);
        existing.record(70); // best 70, play 1
        when(leaderboardRepository.findByGameIdAndUserIdAndMode(1L, 2L, LeaderboardMode.MULTI)).thenReturn(Optional.of(existing));
        when(leaderboardRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.settleToDb(1L, LeaderboardMode.MULTI, List.of(new GameResultEntry(1, "2", "회원", 88, 5, true, 0)));

        assertThat(existing.getBestScore()).isEqualTo(88);
        assertThat(existing.getPlayCount()).isEqualTo(2);
    }

    @Test
    void 낮은_점수는_최고점을_낮추지_않는다() {
        Leaderboard existing = new Leaderboard(1L, 2L, LeaderboardMode.MULTI);
        existing.record(90);
        when(leaderboardRepository.findByGameIdAndUserIdAndMode(1L, 2L, LeaderboardMode.MULTI)).thenReturn(Optional.of(existing));
        when(leaderboardRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.settleToDb(1L, LeaderboardMode.MULTI, List.of(new GameResultEntry(1, "2", "회원", 40, 2, true, 0)));

        assertThat(existing.getBestScore()).isEqualTo(90); // 유지
        assertThat(existing.getPlayCount()).isEqualTo(2);
    }
}
