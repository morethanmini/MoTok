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

    private static final String FINGER_STAR_RULES =
            "두 손 열 손가락을 별 위치에 맞게 벌려 별자리 모양을 만드는 게임이에요. "
                    + "어떤 손가락이든 별 위에 가 있으면 그 별이 켜지고, 모든 별을 동시에 켠 채 유지하면 완성! "
                    + "목표 모양과 비슷할수록 높은 점수를 받아요.";
    private static final String FINGER_STAR_CONTROLS =
            "카메라에 두 손이 잘 보이도록 자리를 잡고, 열 손가락 끝을 움직여 화면 속 별 위에 올려놓아요.";

    private final GameRepository gameRepository;

    private static final String BODY_FIT_RULES =
            "한 사람이 취한 포즈가 그대로 벽의 구멍이 되고, 나머지 전원이 자기 아바타를 그 구멍에 "
                    + "끼워 맞추는 게임이에요. 구멍에 못 들어가면 벽에 밀려 떨어져요!";
    private static final String BODY_FIT_CONTROLS =
            "카메라에 상반신이 잘 보이게 앉고, 벽이 다가오면 구멍 모양과 같은 포즈를 취해요.";

    @Override
    public void run(ApplicationArguments args) {
        seedBodyFit();
        Game existing = gameRepository.findById(1L).orElse(null);
        if (existing == null) {
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
                    .rules(FINGER_STAR_RULES)
                    .controls(FINGER_STAR_CONTROLS)
                    .build());
            log.info("game catalog seeded: id=1 핑거 스타");
        } else if (existing.getRules() == null) {
            // 상세 안내 컬럼(-75) 추가 전에 시드된 행 — 규칙·조작법만 백필한다(멱등).
            existing.updateGuide(FINGER_STAR_RULES, FINGER_STAR_CONTROLS);
            gameRepository.save(existing);
            log.info("game catalog backfilled: id=1 rules/controls");
        }
    }

    /** 게임④ 몸 끼워 맞추기(S15P11A706-9) 시드 — 라운드 길이는 난이도별로 서버가 계산하므로 기준값만 둔다. */
    private void seedBodyFit() {
        if (gameRepository.findById(4L).isPresent()) {
            return;
        }
        gameRepository.save(Game.builder()
                .id(4L)
                .name("몸 끼워 맞추기")
                .mode("VERSUS")
                .minPlayers(1)
                .maxPlayers(8)
                .roundDurationSec(12)
                .countdownSec(3)
                .supportsBot(false)
                .active(true)
                .category("MOTION")
                .rules(BODY_FIT_RULES)
                .controls(BODY_FIT_CONTROLS)
                .build());
        log.info("game catalog seeded: id=4 몸 끼워 맞추기");
    }
}
