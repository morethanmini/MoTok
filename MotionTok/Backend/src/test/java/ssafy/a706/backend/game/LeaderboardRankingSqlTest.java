package ssafy.a706.backend.game;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.game.dto.LeaderboardRow;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.entity.LeaderboardWeekly;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.repository.LeaderboardRepository;
import ssafy.a706.backend.game.repository.LeaderboardWeeklyRepository;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 순위 정렬을 <b>실제 MySQL</b>에 대고 확인한다.
 *
 * <p>정렬·동점 tie-break·탈퇴 제외는 전부 JPQL 안에 있어서 목 테스트가 닿지 못한다. 목은
 * "리포지토리가 준 순서를 그대로 쓰는가"까지만 보는데, 정작 그 순서를 만드는 게 이 쿼리다.</p>
 *
 * <p>@Transactional이라 넣은 행은 테스트 후 롤백된다. gameId는 실데이터와 겹치지 않게 높은
 * 번호를 쓴다(쿼리가 gameId로 거르므로 다른 게임 기록에 영향받지 않는다).</p>
 */
@SpringBootTest
@TestPropertySource(properties = "app.shop.ai-provider=GPU")
@Transactional
class LeaderboardRankingSqlTest {

    private static final long GAME_ID = 999_101L;
    private static final LeaderboardMode MODE = LeaderboardMode.MULTI;
    private static final LocalDate WEEK = LocalDate.of(2026, 8, 3);
    private static final LocalDateTime EARLY = LocalDateTime.of(2026, 8, 4, 10, 0);
    private static final LocalDateTime LATE = LocalDateTime.of(2026, 8, 4, 18, 0);

    @Autowired UserRepository userRepository;
    @Autowired LeaderboardRepository leaderboardRepository;
    @Autowired LeaderboardWeeklyRepository weeklyRepository;

    private User user(String tag) {
        return userRepository.save(User.builder()
                .email("rank-sql-" + tag + "@test.local")
                .passwordHash("x")
                .nickname("랭크" + tag)
                .build());
    }

    private void board(User user, int score, LocalDateTime achievedAt) {
        Leaderboard row = new Leaderboard(GAME_ID, user.getId(), MODE);
        row.record(score);
        ReflectionTestUtils.setField(row, "bestAchievedAt", achievedAt);
        leaderboardRepository.save(row);
    }

    private void weekly(User user, long sum, LocalDateTime updatedAt) {
        LeaderboardWeekly row = new LeaderboardWeekly(GAME_ID, user.getId(), MODE, WEEK);
        row.record("sess-" + user.getId(), 0);
        ReflectionTestUtils.setField(row, "scoreSum", sum);
        ReflectionTestUtils.setField(row, "updatedAt", updatedAt);
        weeklyRepository.save(row);
    }

    private List<Long> topUserIds() {
        return leaderboardRepository.findTopRows(GAME_ID, MODE, PageRequest.of(0, 10))
                .stream().map(LeaderboardRow::userId).toList();
    }

    /**
     * 동점 tie-break 두 단계가 다 걸리는지. 셋 다 100점이고,
     * first·same은 달성 시각까지 같아 userId가 최종 결정자가 된다.
     */
    @Test
    void 동점이면_먼저_달성한_사람이_위이고_시각까지_같으면_userId로_가른다() {
        User first = user("A");
        User same = user("B");   // first와 같은 시각 — id가 더 크다
        User later = user("C");  // 같은 점수인데 나중에 달성
        board(first, 100, EARLY);
        board(same, 100, EARLY);
        board(later, 100, LATE);

        assertThat(topUserIds()).containsExactly(first.getId(), same.getId(), later.getId());
    }

    /** 높은 점수가 먼저 — 시각 tie-break가 점수를 뒤집으면 안 된다. */
    @Test
    void 점수가_시각보다_우선한다() {
        User low = user("D");    // 먼저 달성했지만 낮은 점수
        User high = user("E");
        board(low, 50, EARLY);
        board(high, 90, LATE);

        assertThat(topUserIds()).containsExactly(high.getId(), low.getId());
    }

    @Test
    void 탈퇴_회원은_점수가_가장_높아도_목록에도_순위_계산에도_없다() {
        User alive = user("F");
        User gone = user("G");
        board(alive, 50, LATE);
        board(gone, 999, EARLY);
        gone.softDelete();
        userRepository.save(gone);

        assertThat(topUserIds()).containsExactly(alive.getId());
        // 999점짜리가 세어졌다면 1이 나온다 — 목록과 순위가 같은 모수를 봐야 한다
        assertThat(leaderboardRepository.countAhead(GAME_ID, MODE, 50, LATE, alive.getId())).isZero();
    }

    /** 목록의 순번과 countAhead+1이 어긋나면 상위권 밖 사용자의 순위가 화면과 안 맞는다. */
    @Test
    void countAhead_플러스_1이_목록_순번과_일치한다() {
        User a = user("H");
        User b = user("I");
        User c = user("J");
        board(a, 100, EARLY);
        board(b, 100, LATE);
        board(c, 30, EARLY);

        List<LeaderboardRow> top = leaderboardRepository.findTopRows(GAME_ID, MODE, PageRequest.of(0, 10));
        for (int i = 0; i < top.size(); i++) {
            LeaderboardRow row = top.get(i);
            long rank = leaderboardRepository.countAhead(
                    GAME_ID, MODE, row.score(), row.achievedAt(), row.userId()) + 1;
            assertThat(rank).as("%d번째 항목의 순위", i + 1).isEqualTo(i + 1);
        }
        assertThat(top).hasSize(3);
    }

    /** 주간도 같은 규칙 — 합계가 같으면 그 합계에 먼저 도달한 쪽이 위. */
    @Test
    void 주간도_동점이면_먼저_도달한_사람이_위다() {
        User first = user("K");
        User later = user("L");
        User bigger = user("M");
        weekly(first, 500, EARLY);
        weekly(later, 500, LATE);
        weekly(bigger, 900, LATE);

        List<Long> ids = weeklyRepository.findTopRows(GAME_ID, MODE, WEEK, PageRequest.of(0, 10))
                .stream().map(LeaderboardRow::userId).toList();

        assertThat(ids).containsExactly(bigger.getId(), first.getId(), later.getId());
        assertThat(weeklyRepository.countAhead(GAME_ID, MODE, WEEK, 500, LATE, later.getId()))
                .isEqualTo(2);
    }

    /** 다른 주 기록이 이번 주 순위에 섞이면 주간 랭킹이 매주 초기화되지 않는다. */
    @Test
    void 주간은_요청한_주만_본다() {
        User thisWeek = user("N");
        User lastWeek = user("O");
        weekly(thisWeek, 100, EARLY);
        LeaderboardWeekly old = new LeaderboardWeekly(GAME_ID, lastWeek.getId(), MODE, WEEK.minusWeeks(1));
        old.record("sess-old", 9999);
        weeklyRepository.save(old);

        List<Long> ids = weeklyRepository.findTopRows(GAME_ID, MODE, WEEK, PageRequest.of(0, 10))
                .stream().map(LeaderboardRow::userId).toList();

        assertThat(ids).containsExactly(thisWeek.getId());
    }
}
