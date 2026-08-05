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
 * 현재는 별따라 손따라(id=1) 하나 — as-built 하드코딩 값(라운드 30s·카운트다운 3s)을 그대로 옮긴 것.
 * 게임 2~6이 붙을 때 여기에 행을 추가하거나 관리자 등록으로 확장한다.
 *
 * <p>표시 이름은 상수로 모아 두고 {@code renameIfNeeded}가 기존 행에도 반영한다 —
 * 이름을 바꿀 때 이미 시딩된 DB가 뒤처지지 않게 한다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GameCatalogSeeder implements ApplicationRunner {

    /** 게임① 표시 이름. 식별자(FINGER_STAR·finger-star)는 옛 이름을 그대로 쓴다 — 이름만 바꿨다. */
    private static final String FINGER_STAR_NAME = "별따라 손따라";
    /** 게임④ 표시 이름. 식별자(BODY_FIT·body-fit)는 옛 이름을 그대로 쓴다. */
    private static final String BODY_FIT_NAME = "그대로 멈춰라";

    /** 별따라 손따라 60초 매치 총 시간(초) — FE FingerStarGame MATCH_SECONDS와 동기화 필수. */
    private static final int FINGER_STAR_TOTAL_SEC = 60;
    private static final String FINGER_STAR_RULES =
            "60초 동안 화면에 나타나는 별자리를 최대한 많이 완성하는 게임이에요. "
                    + "두 손 열 손가락을 별 위치에 맞게 벌려 모든 별을 동시에 켠 채 3초 유지하면 완성 — "
                    + "즉시 다음 별자리가 나와요. 완성 개수가 많을수록, 같으면 평균 점수가 높을수록 이겨요.";
    private static final String FINGER_STAR_CONTROLS =
            "카메라에 두 손이 잘 보이도록 자리를 잡고, 열 손가락 끝을 움직여 화면 속 별 위에 올려놓아요.";

    /** 그림으로 말해요 총 그리기 시간(초) — FE drawing-relay/logic.ts TOTAL_SECONDS와 동기화 필수. */
    private static final int DRAW_TOTAL_SEC = 90;
    /** 시작 최소 인원 — 이어그리기라 혼자 할 수 없다(FE logic.ts MIN_PLAYERS와 동기화). */
    private static final int DRAW_MIN_PLAYERS = 3;
    private static final String DRAW_RULES =
            "총 1분 30초를 인원수로 나눠 한 도화지에 그림을 이어 그리는 협동 게임이에요(3명부터). "
                    + "완성 그림을 본 AI가 무엇인지 5가지로 추측하고, 그 안에 주제어가 있으면 순위에 따라 점수를 받아요.";
    private static final String DRAW_CONTROLS =
            "펜 손(기본 오른손) 엄지+검지를 집으면 그려지고, 지우개 손(기본 왼손) 주먹을 쥐고 문지르면 지워져요.";

    private final GameRepository gameRepository;

    private static final String BODY_FIT_RULES =
            "한 사람이 취한 포즈가 그대로 벽의 구멍이 되고, 나머지 전원이 자기 아바타를 그 구멍에 "
                    + "끼워 맞추는 게임이에요. 구멍에 못 들어가면 벽에 밀려 떨어져요!";
    private static final String BODY_FIT_CONTROLS =
            "카메라에 상반신이 잘 보이게 앉고, 벽이 다가오면 구멍 모양과 같은 포즈를 취해요.";

    /**
     * 게임⑤ 모션 낚시 한 판 시간(초).
     *
     * <p>FE에 같은 상수가 없다 — 낚시 루프(loop.ts)는 총 시간을 모르고, FishingGame이 세션의
     * endAt만 보고 끝낸다. 그래서 이 값을 바꾸면 FE 수정 없이 그대로 반영된다(게임①·⑩의
     * "FE와 동기화 필수"와 다른 이유).</p>
     */
    private static final int FISHING_TOTAL_SEC = 90;
    private static final String FISHING_RULES =
            "90초 동안 물고기를 낚아 점수를 모으는 게임이에요. 어종은 깊이 층이 나뉘어 있어서 "
                    + "미끼를 어느 깊이에 두는지가 무엇을 낚는지를 정해요 — 멸치(5점)는 얕고 "
                    + "상어(120점)는 가장 깊어요. 총점이 높은 사람이 이겨요.";
    private static final String FISHING_CONTROLS =
            "양손으로 대를 쥐고 뒤로 젖혀 조준한 뒤 앞으로 휘둘러 던져요. 기다리는 동안 양손 높이로 "
                    + "미끼 깊이를 조절하고, 입질이 오면 손을 위로 번쩍 들어 챔질한 뒤 한 손으로 릴을 감아요.";

    @Override
    public void run(ApplicationArguments args) {
        seedBodyFit();
        seedFishing();
        Game existing = gameRepository.findById(1L).orElse(null);
        if (existing == null) {
            gameRepository.save(Game.builder()
                    .id(1L)
                    .name(FINGER_STAR_NAME)
                    .mode("VERSUS")
                    .minPlayers(1)
                    .maxPlayers(8)
                    .roundDurationSec(FINGER_STAR_TOTAL_SEC)
                    .countdownSec(3)
                    .supportsBot(false)
                    .active(true)
                    .category("MOTION")
                    .rules(FINGER_STAR_RULES)
                    .controls(FINGER_STAR_CONTROLS)
                    .build());
            log.info("game catalog seeded: id=1 {}", FINGER_STAR_NAME);
        } else {
            if (existing.getRoundDurationSec() != FINGER_STAR_TOTAL_SEC || existing.getRules() == null) {
                // 총 시간이 바뀐 뒤(라운드 30s·90s) 또는 상세 안내(-75) 전에 시드된 행 — 규칙을 백필한다(멱등).
                existing.updateSessionRules(FINGER_STAR_TOTAL_SEC, existing.getMinPlayers());
                existing.updateGuide(FINGER_STAR_RULES, FINGER_STAR_CONTROLS);
                gameRepository.save(existing);
                log.info("game catalog backfilled: id=1 roundDurationSec={} rules/controls", FINGER_STAR_TOTAL_SEC);
            }
            renameIfNeeded(existing, FINGER_STAR_NAME);
        }

        // 그림으로 말해요(명세 v0.2.20) — roundDurationSec은 총 그리기 시간,
        // 인당 시간은 세션 시작 시 ceil(총 시간/인원)로 분배된다. 최소 인원은 세션 시작에서 강제한다.
        Game draw = gameRepository.findById(10L).orElse(null);
        if (draw == null) {
            gameRepository.save(Game.builder()
                    .id(10L)
                    .name("그림으로 말해요")
                    .mode("COOP")
                    .minPlayers(DRAW_MIN_PLAYERS)
                    .maxPlayers(8)
                    .roundDurationSec(DRAW_TOTAL_SEC)
                    .countdownSec(3)
                    .supportsBot(false)
                    .active(true)
                    .category("PARTY")
                    .rules(DRAW_RULES)
                    .controls(DRAW_CONTROLS)
                    .build());
            log.info("game catalog seeded: id=10 그림으로 말해요");
        } else if (draw.getRoundDurationSec() != DRAW_TOTAL_SEC || draw.getMinPlayers() != DRAW_MIN_PLAYERS) {
            // 규칙 조정 전에 시딩된 행 — 총 시간·최소 인원·안내 문구를 백필한다(멱등).
            draw.updateSessionRules(DRAW_TOTAL_SEC, DRAW_MIN_PLAYERS);
            draw.updateGuide(DRAW_RULES, DRAW_CONTROLS);
            gameRepository.save(draw);
            log.info("game catalog backfilled: id=10 roundDurationSec={} minPlayers={}",
                    DRAW_TOTAL_SEC, DRAW_MIN_PLAYERS);
        }
    }

    /** 게임④ 그대로 멈춰라(S15P11A706-9) 시드 — 라운드 길이는 난이도별로 서버가 계산하므로 기준값만 둔다. */
    private void seedBodyFit() {
        Game existing = gameRepository.findById(4L).orElse(null);
        if (existing != null) {
            renameIfNeeded(existing, BODY_FIT_NAME);
            return;
        }
        gameRepository.save(Game.builder()
                .id(4L)
                .name(BODY_FIT_NAME)
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
        log.info("game catalog seeded: id=4 {}", BODY_FIT_NAME);
    }

    /**
     * 표시 이름이 다르면 맞춘다(멱등).
     *
     * <p>시더는 없는 행만 만들므로 이름을 바꿔도 이미 시딩된 DB는 옛 이름이 남는다 —
     * 개발·배포 환경마다 다른 이름이 보이고, 손으로 UPDATE 하는 수밖에 없어진다.
     * 관리자가 이름을 고치는 기능은 없으므로 시더가 원천을 강제해도 덮을 것이 없다.</p>
     */
    private void renameIfNeeded(Game game, String name) {
        if (name.equals(game.getName())) {
            return;
        }
        String before = game.getName();
        game.rename(name);
        gameRepository.save(game);
        log.info("game catalog renamed: id={} {} -> {}", game.getId(), before, name);
    }

    /** 게임⑤ 모션 낚시(S15P11A706-49) 시드 — 90초 단판, 점수 = 낚은 물고기 점수 합계. */
    private void seedFishing() {
        if (gameRepository.findById(11L).isPresent()) {
            return;
        }
        gameRepository.save(Game.builder()
                .id(11L)
                .name("모션 낚시")
                .mode("VERSUS")
                .minPlayers(1)
                .maxPlayers(8)
                .roundDurationSec(FISHING_TOTAL_SEC)
                .countdownSec(3)
                .supportsBot(false)
                .active(true)
                .category("MOTION")
                .rules(FISHING_RULES)
                .controls(FISHING_CONTROLS)
                .build());
        log.info("game catalog seeded: id=11 모션 낚시");
    }
}
