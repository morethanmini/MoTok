package ssafy.a706.backend.user.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.repository.GameRankRedisRepository;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.game.repository.LeaderboardRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.controller.dto.GameRecordResponse;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 회원 전적 조회(-97·-141) 단위 테스트.
 * 시나리오: 404 / 빈 전적 / 게임·모드 정렬과 순위 / 카탈로그 이탈 게임 제외 / ZSET 부분 유실 자가 복구.
 */
@ExtendWith(MockitoExtension.class)
class UserRecordServiceTest {

    private static final long USER_ID = 7L;

    @Mock UserRepository userRepository;
    @Mock LeaderboardRepository leaderboardRepository;
    @Mock GameRepository gameRepository;
    @Mock GameRankRedisRepository rankRepository;

    @InjectMocks UserRecordService service;

    private User activeUser() {
        User user = User.builder().nickname("모톡러").build();
        ReflectionTestUtils.setField(user, "id", USER_ID);
        return user;
    }

    private Leaderboard row(long gameId, LeaderboardMode mode, int score, int plays) {
        Leaderboard row = new Leaderboard(gameId, USER_ID, mode);
        for (int i = 0; i < plays; i++) {
            row.record(score);
        }
        return row;
    }

    private Game game(long id, String name) {
        return Game.builder().id(id).name(name).build();
    }

    private void givenActiveUser() {
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(activeUser()));
    }

    @Test
    void 없는_회원이면_USER_NOT_FOUND() {
        when(userRepository.findById(USER_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.records(USER_ID))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.USER_NOT_FOUND);
    }

    @Test
    void 기록이_없으면_빈_목록() {
        givenActiveUser();
        when(leaderboardRepository.findAllByUserId(USER_ID)).thenReturn(new ArrayList<>());

        assertThat(service.records(USER_ID)).isEmpty();
    }

    @Test
    void 게임순으로_묶고_같은_게임은_멀티를_먼저_순위는_ZREVRANK_1기반() {
        givenActiveUser();
        List<Leaderboard> rows = new ArrayList<>(List.of(
                row(10L, LeaderboardMode.MULTI, 500, 2),
                row(1L, LeaderboardMode.SOLO, 800, 3),
                row(1L, LeaderboardMode.MULTI, 900, 5)));
        when(leaderboardRepository.findAllByUserId(USER_ID)).thenReturn(rows);
        when(gameRepository.findAllById(anyList()))
                .thenReturn(List.of(game(1L, "핑거 스타"), game(10L, "그림으로 말해요")));
        when(rankRepository.size(anyLong(), any())).thenReturn(5L); // warm-up 불필요
        when(rankRepository.reverseRankOf(anyLong(), any(), eq(USER_ID))).thenReturn(Optional.of(2L));

        List<GameRecordResponse> records = service.records(USER_ID);

        assertThat(records).extracting(GameRecordResponse::gameId).containsExactly(1L, 1L, 10L);
        assertThat(records).extracting(GameRecordResponse::mode).containsExactly("MULTI", "SOLO", "MULTI");
        assertThat(records.get(0))
                .satisfies(record -> {
                    assertThat(record.gameName()).isEqualTo("핑거 스타");
                    assertThat(record.bestScore()).isEqualTo(900);
                    assertThat(record.playCount()).isEqualTo(5);
                    assertThat(record.rankNo()).isEqualTo(3); // 0-기반 2 → 1-기반 3
                });
    }

    /**
     * 리더보드(-96)와 같은 선 — 혼자 시작할 수 없는 게임(minPlayers ≥ 2)의 솔로 기록은 전적에도 없다.
     * 개발 중 최소 인원을 잠깐 풀고 테스트한 잔재라, 두면 "3명부터"라는 규칙 안내와 어긋난다.
     */
    @Test
    void 혼자_할_수_없는_게임의_솔로_기록은_전적에서_뺀다() {
        givenActiveUser();
        List<Leaderboard> rows = new ArrayList<>(List.of(
                row(10L, LeaderboardMode.MULTI, 500, 2),
                row(10L, LeaderboardMode.SOLO, 300, 1)));
        when(leaderboardRepository.findAllByUserId(USER_ID)).thenReturn(rows);
        when(gameRepository.findAllById(anyList())).thenReturn(List.of(
                Game.builder().id(10L).name("그림으로 말해요").minPlayers(3).maxPlayers(8).build()));
        when(rankRepository.size(10L, LeaderboardMode.MULTI)).thenReturn(5L);
        when(rankRepository.reverseRankOf(10L, LeaderboardMode.MULTI, USER_ID)).thenReturn(Optional.of(0L));

        List<GameRecordResponse> records = service.records(USER_ID);

        assertThat(records).extracting(GameRecordResponse::mode).containsExactly("MULTI");
    }

    @Test
    void 카탈로그에서_내려간_게임은_노출하지_않는다() {
        givenActiveUser();
        when(leaderboardRepository.findAllByUserId(USER_ID))
                .thenReturn(new ArrayList<>(List.of(row(99L, LeaderboardMode.MULTI, 100, 1))));
        when(gameRepository.findAllById(anyList())).thenReturn(List.of()); // 카탈로그에 없음

        assertThat(service.records(USER_ID)).isEmpty();
    }

    @Test
    void ZSET이_비어_있으면_leaderboards로_warm_up_후_순위를_읽는다() {
        givenActiveUser();
        Leaderboard mine = row(1L, LeaderboardMode.MULTI, 900, 1);
        when(leaderboardRepository.findAllByUserId(USER_ID)).thenReturn(new ArrayList<>(List.of(mine)));
        when(gameRepository.findAllById(anyList())).thenReturn(List.of(game(1L, "핑거 스타")));
        when(rankRepository.size(1L, LeaderboardMode.MULTI)).thenReturn(0L);
        when(leaderboardRepository.findAllByGameIdAndMode(1L, LeaderboardMode.MULTI))
                .thenReturn(List.of(mine));
        when(rankRepository.reverseRankOf(1L, LeaderboardMode.MULTI, USER_ID)).thenReturn(Optional.of(0L));

        List<GameRecordResponse> records = service.records(USER_ID);

        verify(rankRepository).updateRanks(1L, LeaderboardMode.MULTI, Map.of(USER_ID, 900));
        assertThat(records.get(0).rankNo()).isEqualTo(1);
    }

    @Test
    void ZSET에_내_기록만_빠져_있으면_재적재해_자가_복구한다() {
        givenActiveUser();
        Leaderboard mine = row(1L, LeaderboardMode.MULTI, 900, 1);
        when(leaderboardRepository.findAllByUserId(USER_ID)).thenReturn(new ArrayList<>(List.of(mine)));
        when(gameRepository.findAllById(anyList())).thenReturn(List.of(game(1L, "핑거 스타")));
        when(rankRepository.size(1L, LeaderboardMode.MULTI)).thenReturn(3L); // 비어 있지 않음
        when(rankRepository.reverseRankOf(1L, LeaderboardMode.MULTI, USER_ID))
                .thenReturn(Optional.empty())   // 부분 유실 — 나만 없음
                .thenReturn(Optional.of(1L));   // 재적재 후

        List<GameRecordResponse> records = service.records(USER_ID);

        verify(rankRepository).updateRanks(1L, LeaderboardMode.MULTI, Map.of(USER_ID, 900));
        assertThat(records.get(0).rankNo()).isEqualTo(2);
    }
}
