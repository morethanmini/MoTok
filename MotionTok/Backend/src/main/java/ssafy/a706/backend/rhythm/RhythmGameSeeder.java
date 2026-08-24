package ssafy.a706.backend.rhythm;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.repository.GameRepository;

/**
 * 캐치캐치리듬 카탈로그 시드(id=2, 멱등).
 *
 * <p>기존 {@code GameCatalogSeeder}를 고치지 않고 별도 러너로 둔다 — 게임이 늘 때마다
 * 한 파일에 블록을 추가하면 여러 사람이 같은 자리를 건드린다. 각 게임이 자기 행을 심는다.</p>
 *
 * <p>rules/controls는 게임 상세 API(-75)가 무가공으로 내려주므로 비워 두면 카탈로그 모달의
 * 규칙란이 빈 문단이 된다 — 반드시 채운다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RhythmGameSeeder implements ApplicationRunner {

    public static final long GAME_ID = 2L;
    public static final String GAME_NAME = "캐치캐치리듬";

    /** FE ROUND_MS(60초)와 맞춘다 — 어긋나면 서버 타이머와 클라 채보 길이가 갈린다. */
    public static final int ROUND_DURATION_SEC = 60;
    public static final int COUNTDOWN_SEC = 3;

    private static final String RULES =
            "날아오는 음표를 손으로 잡는 리듬 게임이에요. "
                    + "대부분의 음표는 손이 스치기만 해도 잡히고, 길게 이어진 음표는 경로를 따라 손을 움직여야 해요. "
                    + "가끔 나오는 금색 음표만 주먹을 쥐어서 잡습니다. "
                    + "방 전원이 똑같은 채보로 동시에 플레이하고 점수로 겨뤄요.";
    private static final String CONTROLS =
            "카메라에 두 손이 잘 보이도록 자리를 잡아요. "
                    + "음표에 다가오는 원이 판정선과 겹치는 순간 손을 대면 됩니다. "
                    + "파란 음표는 왼손(L), 빨간 음표는 오른손(R), 보라 음표는 아무 손이나 괜찮아요.";

    private final GameRepository gameRepository;

    @Override
    public void run(ApplicationArguments args) {
        Game existing = gameRepository.findById(GAME_ID).orElse(null);
        if (existing == null) {
            gameRepository.save(Game.builder()
                    .id(GAME_ID)
                    .name(GAME_NAME)
                    .mode("VERSUS")
                    .minPlayers(1)
                    .maxPlayers(8)
                    .roundDurationSec(ROUND_DURATION_SEC)
                    .countdownSec(COUNTDOWN_SEC)
                    .supportsBot(false)
                    // 곡 음원의 저작권 확인이 끝나지 않아 카탈로그에서 닫아 둔다. 확인되면 true로
                    // 되돌리거나 관리자 페이지에서 켜면 된다 — 이미 심긴 행은 여기서 건드리지 않는다.
                    .active(false)
                    .category("RHYTHM")
                    .rules(RULES)
                    .controls(CONTROLS)
                    .build());
            log.info("rhythm game seeded: id={} {}", GAME_ID, GAME_NAME);
        } else if (existing.getRules() == null) {
            existing.updateGuide(RULES, CONTROLS);
            gameRepository.save(existing);
            log.info("rhythm game backfilled: id={} rules/controls", GAME_ID);
        }
    }
}
