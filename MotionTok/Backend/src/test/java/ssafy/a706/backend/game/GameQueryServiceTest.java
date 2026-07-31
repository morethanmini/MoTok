package ssafy.a706.backend.game;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.game.dto.GameSummaryResponse;
import ssafy.a706.backend.game.dto.LeaderboardResponse;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.repository.GameRankRedisRepository;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.game.repository.LeaderboardRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 게임 카탈로그·리더보드 조회(-28·-96) 단위 테스트.
 * 시나리오: 404 / Redis 유실 warm-up / 순위·hydration / 탈퇴 노출 제외(-111) / myRank 분기.
 */
@ExtendWith(MockitoExtension.class)
class GameQueryServiceTest {

    private static final long GAME_ID = 1L;
    private static final LeaderboardMode MODE = LeaderboardMode.MULTI;

    @Mock GameRepository gameRepository;
    @Mock LeaderboardRepository leaderboardRepository;
    @Mock GameRankRedisRepository rankRepository;
    @Mock UserRepository userRepository;

    @InjectMocks GameQueryService service;

    private User user(long id, String nickname) {
        User user = User.builder().nickname(nickname).build();
        ReflectionTestUtils.setField(user, "id", id);
        return user;
    }

    private Leaderboard row(long userId, int score, int plays) {
        Leaderboard row = new Leaderboard(GAME_ID, userId, MODE);
        for (int i = 0; i < plays; i++) {
            row.record(score);
        }
        return row;
    }

    private void givenGameExists() {
        when(gameRepository.existsById(GAME_ID)).thenReturn(true);
    }

    @Test
    void 게임이_없으면_GAME_NOT_FOUND() {
        when(gameRepository.existsById(GAME_ID)).thenReturn(false);

        assertThatThrownBy(() -> service.leaderboard(GAME_ID, MODE, 20, null))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.GAME_NOT_FOUND);
    }

    @Test
    void 랭킹_ZSET이_비어_있으면_leaderboards에서_warm_up_후_조회한다() {
        givenGameExists();
        when(rankRepository.size(GAME_ID, MODE)).thenReturn(0L);
        when(leaderboardRepository.findAllByGameIdAndMode(GAME_ID, MODE)).thenReturn(List.of(row(10L, 90, 1)));
        when(rankRepository.topBestScores(eq(GAME_ID), eq(MODE), anyInt()))
                .thenReturn(new LinkedHashMap<>(Map.of(10L, 90)));
        when(userRepository.findAllById(any())).thenReturn(List.of(user(10L, "별잡이")));
        when(leaderboardRepository.findAllByGameIdAndModeAndUserIdIn(eq(GAME_ID), eq(MODE), any()))
                .thenReturn(List.of(row(10L, 90, 1)));

        LeaderboardResponse response = service.leaderboard(GAME_ID, MODE, 20, null);

        verify(rankRepository).updateRanks(GAME_ID, MODE, Map.of(10L, 90));
        assertThat(response.entries()).hasSize(1);
    }

    @Test
    void 상위권을_순위와_닉네임_플레이수와_함께_돌려준다() {
        givenGameExists();
        when(rankRepository.size(GAME_ID, MODE)).thenReturn(2L);
        LinkedHashMap<Long, Integer> top = new LinkedHashMap<>();
        top.put(10L, 95);
        top.put(11L, 80);
        when(rankRepository.topBestScores(eq(GAME_ID), eq(MODE), anyInt())).thenReturn(top);
        when(userRepository.findAllById(any()))
                .thenReturn(List.of(user(10L, "별잡이"), user(11L, "민지")));
        when(leaderboardRepository.findAllByGameIdAndModeAndUserIdIn(eq(GAME_ID), eq(MODE), any()))
                .thenReturn(List.of(row(10L, 95, 3), row(11L, 80, 2)));

        LeaderboardResponse response = service.leaderboard(GAME_ID, MODE, 20, null);

        assertThat(response.gameId()).isEqualTo(GAME_ID);
        assertThat(response.entries()).hasSize(2);
        assertThat(response.entries().get(0).rank()).isEqualTo(1);
        assertThat(response.entries().get(0).nickname()).isEqualTo("별잡이");
        assertThat(response.entries().get(0).bestScore()).isEqualTo(95);
        assertThat(response.entries().get(0).playCount()).isEqualTo(3);
        assertThat(response.entries().get(1).rank()).isEqualTo(2);
        assertThat(response.myRank()).isNull(); // 비로그인
        verify(leaderboardRepository, never()).findAllByGameIdAndMode(anyLong(), any()); // warm-up 불필요
    }

    @Test
    void 탈퇴_회원은_노출에서_제외하고_순위를_다시_매긴다() {
        givenGameExists();
        when(rankRepository.size(GAME_ID, MODE)).thenReturn(3L);
        LinkedHashMap<Long, Integer> top = new LinkedHashMap<>();
        top.put(10L, 95);
        top.put(11L, 80); // 탈퇴 회원
        top.put(12L, 70);
        when(rankRepository.topBestScores(eq(GAME_ID), eq(MODE), anyInt())).thenReturn(top);
        User withdrawn = user(11L, "탈퇴자");
        withdrawn.softDelete();
        when(userRepository.findAllById(any()))
                .thenReturn(List.of(user(10L, "별잡이"), withdrawn, user(12L, "Alex")));
        when(leaderboardRepository.findAllByGameIdAndModeAndUserIdIn(eq(GAME_ID), eq(MODE), any()))
                .thenReturn(List.of(row(10L, 95, 1), row(11L, 80, 1), row(12L, 70, 1)));

        LeaderboardResponse response = service.leaderboard(GAME_ID, MODE, 20, null);

        assertThat(response.entries()).hasSize(2);
        assertThat(response.entries().get(0).userId()).isEqualTo(10L);
        assertThat(response.entries().get(1).userId()).isEqualTo(12L);
        assertThat(response.entries().get(1).rank()).isEqualTo(2); // 재순번 — 3이 아니라 2
    }

    @Test
    void 회원이_노출_목록_안에_있으면_myRank는_그_항목과_일치한다() {
        givenGameExists();
        when(rankRepository.size(GAME_ID, MODE)).thenReturn(1L);
        when(rankRepository.topBestScores(eq(GAME_ID), eq(MODE), anyInt()))
                .thenReturn(new LinkedHashMap<>(Map.of(10L, 95)));
        when(userRepository.findAllById(any())).thenReturn(List.of(user(10L, "별잡이")));
        when(leaderboardRepository.findAllByGameIdAndModeAndUserIdIn(eq(GAME_ID), eq(MODE), any()))
                .thenReturn(List.of(row(10L, 95, 3)));

        LeaderboardResponse response =
                service.leaderboard(GAME_ID, MODE, 20, new MemberPrincipal(10L, "별잡이"));

        assertThat(response.myRank()).isEqualTo(response.entries().get(0));
    }

    @Test
    void 회원이_상위권_밖이면_ZREVRANK_원시_순위로_myRank를_채운다() {
        givenGameExists();
        when(rankRepository.size(GAME_ID, MODE)).thenReturn(50L);
        when(rankRepository.topBestScores(eq(GAME_ID), eq(MODE), anyInt()))
                .thenReturn(new LinkedHashMap<>(Map.of(10L, 95)));
        when(userRepository.findAllById(any())).thenReturn(List.of(user(10L, "별잡이")));
        when(leaderboardRepository.findAllByGameIdAndModeAndUserIdIn(eq(GAME_ID), eq(MODE), any()))
                .thenReturn(List.of(row(10L, 95, 1)));
        when(rankRepository.reverseRankOf(GAME_ID, MODE, 99L)).thenReturn(Optional.of(7L));
        when(leaderboardRepository.findByGameIdAndUserIdAndMode(GAME_ID, 99L, MODE))
                .thenReturn(Optional.of(row(99L, 40, 5)));

        LeaderboardResponse response =
                service.leaderboard(GAME_ID, MODE, 1, new MemberPrincipal(99L, "나"));

        assertThat(response.myRank()).isNotNull();
        assertThat(response.myRank().rank()).isEqualTo(8); // 0-기반 7 → 1-기반 8
        assertThat(response.myRank().bestScore()).isEqualTo(40);
        assertThat(response.myRank().playCount()).isEqualTo(5);
    }

    @Test
    void 게스트나_기록_없는_회원은_myRank가_null이다() {
        givenGameExists();
        when(rankRepository.size(GAME_ID, MODE)).thenReturn(1L);
        when(rankRepository.topBestScores(eq(GAME_ID), eq(MODE), anyInt()))
                .thenReturn(new LinkedHashMap<>(Map.of(10L, 95)));
        when(userRepository.findAllById(any())).thenReturn(List.of(user(10L, "별잡이")));
        when(leaderboardRepository.findAllByGameIdAndModeAndUserIdIn(eq(GAME_ID), eq(MODE), any()))
                .thenReturn(List.of(row(10L, 95, 1)));

        AuthPrincipal guest = mock(AuthPrincipal.class);
        assertThat(service.leaderboard(GAME_ID, MODE, 20, guest).myRank()).isNull();

        when(rankRepository.reverseRankOf(GAME_ID, MODE, 99L)).thenReturn(Optional.empty());
        assertThat(service.leaderboard(GAME_ID, MODE, 20, new MemberPrincipal(99L, "신규"))
                .myRank()).isNull();
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
        when(gameRepository.findAll()).thenReturn(List.of(open, closed));

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
