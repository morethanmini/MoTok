package ssafy.a706.backend.game;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ssafy.a706.backend.game.dto.DrawOp;
import ssafy.a706.backend.game.dto.GameEventResponse;
import ssafy.a706.backend.game.dto.GameResultEntry;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * GameEventResponse 팩토리 위치 인자 검증.
 *
 * <p>이 record는 필드가 27개고 팩토리가 나머지를 전부 null로 채운다. 자리가 밀려도
 * 전부 null이면 <b>컴파일이 통과해버리기 때문에</b> 타입 검사로는 못 잡는다.
 * 게임④(-48)와 게임⑩(명세 v0.2.20)이 같은 record에 동시에 필드를 추가하며 충돌했고,
 * 병합하면서 팩토리 8개의 인자 자리를 전부 다시 배치했다 — 그 재배치가 옳은지를
 * 값이 실제로 그 이름의 필드에 들어갔는지로 확인한다.</p>
 */
class GameEventResponseFactoryTest {

    @Test
    @DisplayName("게임④ 시작 — 과제·출제자·난이도·로테이션·모드가 제 필드에 들어간다")
    void gameStart_maps_body_fit_fields() {
        GameEventResponse e = GameEventResponse.gameStart(
                "sess", 4L, "CHALLENGE", "orion", "setter-1", "hard", 100L, 200L, 300L, 2, 5,
                "pose", null);

        assertThat(e.type()).isEqualTo(GameEventResponse.EventType.GAME_START);
        assertThat(e.sessionId()).isEqualTo("sess");
        assertThat(e.gameId()).isEqualTo(4L);
        assertThat(e.challenge()).isEqualTo("CHALLENGE");
        assertThat(e.constellationKey()).isEqualTo("orion");
        assertThat(e.setterUserId()).isEqualTo("setter-1");
        assertThat(e.difficulty()).isEqualTo("hard");
        assertThat(e.serverNow()).isEqualTo(100L);
        assertThat(e.startAt()).isEqualTo(200L);
        assertThat(e.endAt()).isEqualTo(300L);
        assertThat(e.roundNo()).isEqualTo(2);
        assertThat(e.totalRounds()).isEqualTo(5);
        assertThat(e.mode()).isEqualTo("pose");
        assertThat(e.wallCount()).isNull(); // 출제 대결은 벽 수가 없다
        // 게임⑩ 칸은 비어 있어야 한다
        assertThat(e.topicWord()).isNull();
        assertThat(e.turnOrder()).isNull();
        assertThat(e.seq()).isNull();
    }

    @Test
    @DisplayName("게임④ 연속 서바이벌 시작 — 시드는 challenge, 벽 수는 wallCount, 출제자는 없다")
    void gameStart_maps_chain_fields() {
        GameEventResponse e = GameEventResponse.gameStart(
                "sess", 4L, "123456789", null, null, "normal", 100L, 200L, 300L, null, null,
                "chain", 20);

        assertThat(e.challenge()).isEqualTo("123456789"); // 포즈 시드 — 전원이 같은 벽을 만드는 입력
        assertThat(e.mode()).isEqualTo("chain");
        assertThat(e.wallCount()).isEqualTo(20);
        assertThat(e.setterUserId()).isNull();
        assertThat(e.roundNo()).isNull(); // 로테이션이 없다
        assertThat(e.totalRounds()).isNull();
    }

    @Test
    @DisplayName("게임⑩ 시작 — 주제어·턴 스케줄이 제 필드에 들어간다")
    void gameStartDraw_maps_draw_fields() {
        GameEventResponse e = GameEventResponse.gameStartDraw(
                "sess", 10L, 100L, 200L, 300L, "사과", List.of("u1", "u2"), 15, 3);

        assertThat(e.type()).isEqualTo(GameEventResponse.EventType.GAME_START);
        assertThat(e.sessionId()).isEqualTo("sess");
        assertThat(e.gameId()).isEqualTo(10L);
        assertThat(e.serverNow()).isEqualTo(100L);
        assertThat(e.startAt()).isEqualTo(200L);
        assertThat(e.endAt()).isEqualTo(300L);
        assertThat(e.topicWord()).isEqualTo("사과");
        assertThat(e.turnOrder()).containsExactly("u1", "u2");
        assertThat(e.turnDurationSec()).isEqualTo(15);
        assertThat(e.handoverSec()).isEqualTo(3);
        // 게임④ 칸은 비어 있어야 한다
        assertThat(e.challenge()).isNull();
        assertThat(e.setterUserId()).isNull();
        assertThat(e.difficulty()).isNull();
        assertThat(e.roundNo()).isNull();
    }

    @Test
    @DisplayName("게임④ 출제 포즈 — challenge와 userId 양쪽에 출제자가 실린다")
    void poseSet_maps_fields() {
        GameEventResponse e = GameEventResponse.poseSet("sess", "setter-1", "{landmarks}");

        assertThat(e.type()).isEqualTo(GameEventResponse.EventType.POSE_SET);
        assertThat(e.challenge()).isEqualTo("{landmarks}");
        assertThat(e.setterUserId()).isEqualTo("setter-1");
        assertThat(e.userId()).isEqualTo("setter-1");
    }

    @Test
    @DisplayName("진행 상황 — 참가자 지표가 제 필드에 들어간다")
    void progress_maps_fields() {
        GameEventResponse e = GameEventResponse.progress("sess", "u1", "닉", 7, 0.5);

        assertThat(e.type()).isEqualTo(GameEventResponse.EventType.PROGRESS);
        assertThat(e.userId()).isEqualTo("u1");
        assertThat(e.nickname()).isEqualTo("닉");
        assertThat(e.starsLit()).isEqualTo(7);
        assertThat(e.holdProgress()).isEqualTo(0.5);
        assertThat(e.score()).isNull();
    }

    @Test
    @DisplayName("완주 — score와 starsHit이 뒤바뀌지 않는다")
    void playerFinished_maps_fields() {
        GameEventResponse e = GameEventResponse.playerFinished("sess", "u1", "닉", 85, 3);

        assertThat(e.type()).isEqualTo(GameEventResponse.EventType.PLAYER_FINISHED);
        assertThat(e.userId()).isEqualTo("u1");
        assertThat(e.nickname()).isEqualTo("닉");
        assertThat(e.score()).isEqualTo(85);
        assertThat(e.starsHit()).isEqualTo(3);
        assertThat(e.starsLit()).isNull();
    }

    @Test
    @DisplayName("정산 — results가 제 자리에 들어간다")
    void gameEnd_maps_results() {
        List<GameResultEntry> results = List.of(new GameResultEntry(1, "u1", "닉", 100, 3, true, 10));
        GameEventResponse e = GameEventResponse.gameEnd("sess", results);

        assertThat(e.type()).isEqualTo(GameEventResponse.EventType.GAME_END);
        assertThat(e.results()).isEqualTo(results);
        assertThat(e.score()).isNull();
    }

    @Test
    @DisplayName("그리기 릴레이 — seq·ops가 제 필드에 들어간다")
    void draw_maps_fields() {
        List<DrawOp> ops = List.of();
        GameEventResponse e = GameEventResponse.draw("sess", "u1", 42L, ops);

        assertThat(e.type()).isEqualTo(GameEventResponse.EventType.DRAW);
        assertThat(e.userId()).isEqualTo("u1");
        assertThat(e.seq()).isEqualTo(42L);
        assertThat(e.ops()).isEqualTo(ops);
        assertThat(e.startAt()).isNull();
    }

    @Test
    @DisplayName("AI 채점 — guesses·answerRank·score가 제 필드에 들어간다")
    void drawResult_maps_fields() {
        GameEventResponse e = GameEventResponse.drawResult("sess", "u1", List.of("사과", "토마토"), 1, 100);

        assertThat(e.type()).isEqualTo(GameEventResponse.EventType.DRAW_RESULT);
        assertThat(e.userId()).isEqualTo("u1");
        assertThat(e.guesses()).containsExactly("사과", "토마토");
        assertThat(e.answerRank()).isEqualTo(1);
        assertThat(e.score()).isEqualTo(100);
        assertThat(e.starsHit()).isNull();
    }
}
