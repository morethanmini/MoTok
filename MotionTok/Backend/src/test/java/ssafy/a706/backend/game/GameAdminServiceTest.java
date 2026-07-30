package ssafy.a706.backend.game;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ssafy.a706.backend.game.dto.AdminGameResponse;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 관리자 게임 관리(-106) 단위 테스트.
 * 시나리오: 닫아 둔 게임까지 조회 / 토글 / 멱등 / 없는 게임 404 / 싱글·멀티 분류 기준.
 */
@ExtendWith(MockitoExtension.class)
class GameAdminServiceTest {

    private static final long ADMIN_ID = 1L;

    @Mock GameRepository gameRepository;

    @InjectMocks GameAdminService service;

    private Game game(long id, String name, String mode, int min, int max, boolean active) {
        return Game.builder()
                .id(id).name(name).mode(mode).minPlayers(min).maxPlayers(max)
                .roundDurationSec(30).countdownSec(3).active(active).category("MOTION").build();
    }

    /**
     * 공개 목록과 다른 점 — 닫아 둔 게임이 여기서도 안 보이면 <b>다시 열 방법이 없다.</b>
     * 이 화면이 유일한 복구 경로다.
     */
    @Test
    void 닫아_둔_게임까지_전부_돌려준다() {
        when(gameRepository.findAll(any(org.springframework.data.domain.Sort.class))).thenReturn(List.of(
                game(1L, "핑거 스타", "VERSUS", 1, 8, true),
                game(10L, "그림으로 말해요", "COOP", 3, 8, false)));

        List<AdminGameResponse> games = service.list();

        assertThat(games).hasSize(2);
        assertThat(games.get(0).active()).isTrue();
        assertThat(games.get(1).active()).isFalse();
    }

    /**
     * 싱글/멀티 분류의 기준은 mode가 아니라 인원이다 — mode는 게임의 성격(대결/협동)일 뿐이고,
     * 혼자 시작할 수 있는지는 min_players가 정한다(서버도 같은 값으로 거부한다).
     */
    @Test
    void soloCapable은_최소_인원으로_판정한다() {
        when(gameRepository.findAll(any(org.springframework.data.domain.Sort.class))).thenReturn(List.of(
                game(1L, "핑거 스타", "VERSUS", 1, 8, true),   // 대결 모드지만 혼자도 된다
                game(10L, "그림으로 말해요", "COOP", 3, 8, true)));

        List<AdminGameResponse> games = service.list();

        assertThat(games.get(0).soloCapable()).isTrue();
        assertThat(games.get(1).soloCapable()).isFalse();
    }

    @Test
    void 토글하면_엔티티_상태가_바뀌고_갱신된_항목을_돌려준다() {
        Game target = game(1L, "핑거 스타", "VERSUS", 1, 8, true);
        when(gameRepository.findById(1L)).thenReturn(Optional.of(target));

        AdminGameResponse closed = service.changeActive(ADMIN_ID, 1L, false);

        assertThat(closed.active()).isFalse();
        assertThat(target.isActive()).isFalse();
    }

    /** 같은 값으로 다시 눌러도 실패가 아니다 — 결과 상태가 요청과 같으므로 관리자가 대응할 게 없다. */
    @Test
    void 같은_값으로_다시_눌러도_성공한다() {
        Game target = game(1L, "핑거 스타", "VERSUS", 1, 8, false);
        when(gameRepository.findById(1L)).thenReturn(Optional.of(target));

        assertThat(service.changeActive(ADMIN_ID, 1L, false).active()).isFalse();
        assertThat(target.isActive()).isFalse();
    }

    @Test
    void 없는_게임을_토글하면_GAME_NOT_FOUND() {
        when(gameRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.changeActive(ADMIN_ID, 99L, false))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.GAME_NOT_FOUND);
    }
}
