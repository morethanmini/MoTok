package ssafy.a706.backend.game.entity;

import org.junit.jupiter.api.Test;
import ssafy.a706.backend.game.model.LeaderboardMode;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 동점 tie-break의 기준값인 best_achieved_at이 <b>최고점을 처음 찍은 시각</b>으로만 움직이는지.
 * 이게 updated_at처럼 매 판 갱신되면 점수가 안 오르는데 계속 플레이한 사람이 순위를 잃는다.
 */
class LeaderboardTest {

    private Leaderboard newRow() {
        return new Leaderboard(1L, 2L, LeaderboardMode.MULTI);
    }

    /** 두 record() 사이에 시계가 반드시 움직이게 — 같은 마이크로초에 떨어지면 판정이 흔들린다. */
    private void tick() throws InterruptedException {
        Thread.sleep(2);
    }

    @Test
    void 최고점이_갱신될_때만_달성_시각이_움직인다() throws InterruptedException {
        Leaderboard row = newRow();
        row.record(70);
        LocalDateTime achieved = row.getBestAchievedAt();
        tick();

        row.record(90);
        assertThat(row.getBestAchievedAt()).isAfter(achieved);
        assertThat(row.getBestScore()).isEqualTo(90);
    }

    @Test
    void 최고점을_못_넘는_판은_달성_시각을_건드리지_않는다() throws InterruptedException {
        Leaderboard row = newRow();
        row.record(90);
        LocalDateTime achieved = row.getBestAchievedAt();
        tick();

        row.record(40);  // 더 낮은 점수
        row.record(90);  // 같은 점수 재달성 — 새 기록이 아니다

        assertThat(row.getBestAchievedAt()).isEqualTo(achieved);
        assertThat(row.getBestScore()).isEqualTo(90);
        assertThat(row.getPlayCount()).isEqualTo(3);
        // 매 판 움직이는 값은 updated_at 쪽이다 — 둘이 갈라져야 tie-break가 성립한다
        assertThat(row.getUpdatedAt()).isAfter(achieved);
    }

    /** 첫 판이 0점이면 record()의 갱신 조건(score > 0)에 걸리지 않는다 — 생성자가 채워 둬야 NOT NULL이 지켜진다. */
    @Test
    void 첫_판이_0점이어도_달성_시각은_비지_않는다() {
        Leaderboard row = newRow();
        row.record(0);

        assertThat(row.getBestAchievedAt()).isNotNull();
    }
}
