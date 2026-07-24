package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.repository.GameRepository;

/**
 * 게임 카탈로그 시드. 부팅 시 기본 게임이 없으면 넣는다(멱등).
 * 현재는 핑거 스타(id=1) 하나 — as-built 하드코딩 값(라운드 30s·카운트다운 3s)을 그대로 옮긴 것.
 * 게임 2~6이 붙을 때 여기에 행을 추가하거나 관리자 등록으로 확장한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GameCatalogSeeder implements ApplicationRunner {

    private final GameRepository gameRepository;

    @Override
    public void run(ApplicationArguments args) {
        if (!gameRepository.existsById(1L)) {
            gameRepository.save(Game.builder()
                    .id(1L)
                    .name("핑거 스타")
                    .mode("VERSUS")
                    .minPlayers(1)
                    .maxPlayers(8)
                    .roundDurationSec(30)
                    .countdownSec(3)
                    .supportsBot(false)
                    .active(true)
                    .category("MOTION")
                    .build());
            log.info("game catalog seeded: id=1 핑거 스타");
        }
    }
}
