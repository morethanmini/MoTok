package ssafy.a706.backend.game;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.repository.GameRepository;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * 시더의 표시 이름 백필 — 게임 이름을 바꿀 때 <b>이미 시딩된 DB</b>가 뒤처지지 않는지.
 *
 * <p>시더는 없는 행만 만들고 이름은 갱신하지 않았다. 그래서 이름을 바꿔도 팀원 로컬·배포 서버는
 * 옛 이름이 그대로 남아 환경마다 다른 이름이 보였다 — 손으로 UPDATE 하는 수밖에 없었다.</p>
 *
 * <p>관리자가 이름을 고치는 기능은 없으므로(AdminGameService는 active 토글만) 시더가 원천을
 * 강제해도 덮을 사용자 입력이 없다.</p>
 */
@ExtendWith(MockitoExtension.class)
class GameCatalogSeederRenameTest {

    private static final String FINGER_STAR = "별따라 손따라";
    private static final String BODY_FIT = "그대로 멈춰라";

    @Mock GameRepository gameRepository;

    @InjectMocks GameCatalogSeeder seeder;

    private Game game(long id, String name) {
        return Game.builder()
                .id(id).name(name).mode("VERSUS").minPlayers(1).maxPlayers(8)
                .roundDurationSec(60).countdownSec(3).active(true).category("MOTION")
                // 규칙 백필 분기(rules == null)를 타지 않도록 채운다 — 여기서 볼 것은 이름뿐이다.
                .rules("r").controls("c")
                .build();
    }

    /** 시더가 만지는 4개 id 중 인자로 준 것만 "이미 있는" 상태로 둔다. */
    private void existing(Game... rows) {
        lenient().when(gameRepository.findById(any())).thenReturn(Optional.empty());
        for (Game g : rows) {
            lenient().when(gameRepository.findById(g.getId())).thenReturn(Optional.of(g));
        }
        lenient().when(gameRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    @DisplayName("옛 이름으로 시딩된 행은 새 이름으로 맞춰진다")
    void renames_rows_seeded_with_old_names() {
        Game fingerStar = game(1L, "핑거 스타");
        Game bodyFit = game(4L, "몸 끼워 맞추기");
        existing(fingerStar, bodyFit);

        seeder.run(null);

        assertThat(fingerStar.getName()).isEqualTo(FINGER_STAR);
        assertThat(bodyFit.getName()).isEqualTo(BODY_FIT);
    }

    @Test
    @DisplayName("이미 새 이름이면 그대로 둔다(멱등) — 부팅마다 쓰지 않는다")
    void leaves_rows_that_already_match() {
        Game fingerStar = game(1L, FINGER_STAR);
        Game bodyFit = game(4L, BODY_FIT);
        existing(fingerStar, bodyFit);

        seeder.run(null);
        seeder.run(null);

        assertThat(fingerStar.getName()).isEqualTo(FINGER_STAR);
        assertThat(bodyFit.getName()).isEqualTo(BODY_FIT);
    }

    @Test
    @DisplayName("빈 DB에는 새 이름으로 생성된다")
    void seeds_new_names_into_empty_db() {
        existing(); // 아무 행도 없음

        seeder.run(null);

        // save 로 넘어간 행 중 id 1·4의 이름을 확인한다.
        org.mockito.ArgumentCaptor<Game> saved = org.mockito.ArgumentCaptor.forClass(Game.class);
        org.mockito.Mockito.verify(gameRepository, org.mockito.Mockito.atLeastOnce()).save(saved.capture());

        assertThat(saved.getAllValues())
                .filteredOn(g -> g.getId() == 1L)
                .extracting(Game::getName)
                .containsExactly(FINGER_STAR);
        assertThat(saved.getAllValues())
                .filteredOn(g -> g.getId() == 4L)
                .extracting(Game::getName)
                .containsExactly(BODY_FIT);
    }

    @Test
    @DisplayName("다른 게임의 이름은 건드리지 않는다")
    void does_not_touch_other_games() {
        Game rhythm = game(2L, "캐치캐치리듬");
        Game draw = game(10L, "그림으로 말해요");
        existing(game(1L, FINGER_STAR), game(4L, BODY_FIT), rhythm, draw);

        seeder.run(null);

        assertThat(rhythm.getName()).isEqualTo("캐치캐치리듬");
        assertThat(draw.getName()).isEqualTo("그림으로 말해요");
    }
}
