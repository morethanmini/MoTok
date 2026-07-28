package ssafy.a706.backend.game.draw;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 그림으로 말해요 채점 판정(DrawJudge) — AI 응답 파싱과 주제어 매칭.
 *
 * <p>프론트에 있던 로직을 서버로 옮기면서 함께 옮긴 검증이다. 채점 점수가 서버 권위가 됐으므로
 * 이 판정이 곧 최종 점수이고, 모델이 형식을 안 지켜도 채점이 죽지 않아야 한다.</p>
 */
class DrawJudgeTest {

    @Test
    @DisplayName("순위 점수 — 1위 100점, 3위 60점, 5위 20점, 순위 밖은 0점")
    void scoreForRank() {
        assertThat(DrawJudge.scoreForRank(1)).isEqualTo(100);
        assertThat(DrawJudge.scoreForRank(2)).isEqualTo(80);
        assertThat(DrawJudge.scoreForRank(3)).isEqualTo(60);
        assertThat(DrawJudge.scoreForRank(4)).isEqualTo(40);
        assertThat(DrawJudge.scoreForRank(5)).isEqualTo(20);
        assertThat(DrawJudge.scoreForRank(0)).isZero();
        assertThat(DrawJudge.scoreForRank(6)).isZero();
    }

    @Test
    @DisplayName("정답 매칭 — 정확히 일치하는 추측의 순위를 1-based로 돌려준다")
    void findAnswerRankExact() {
        assertThat(DrawJudge.findAnswerRank("사과", List.of("수박", "사과", "공"))).isEqualTo(2);
        assertThat(DrawJudge.findAnswerRank("사과", List.of("수박", "공", "달"))).isZero();
    }

    @Test
    @DisplayName("정답 매칭 — 공백·대소문자·따옴표는 무시한다")
    void findAnswerRankNormalizes() {
        assertThat(DrawJudge.findAnswerRank("아이스크림", List.of("\"아이스 크림\""))).isEqualTo(1);
        assertThat(DrawJudge.findAnswerRank("Robot", List.of("robot"))).isEqualTo(1);
    }

    @Test
    @DisplayName("정답 매칭 — 두 글자 이상이면 포함 관계도 정답, 한 글자는 정확 일치만")
    void findAnswerRankPartial() {
        assertThat(DrawJudge.findAnswerRank("사과", List.of("사과나무"))).isEqualTo(1);
        assertThat(DrawJudge.findAnswerRank("사과나무", List.of("수박", "사과"))).isEqualTo(2);
        // "배" ↔ "배구"까지 정답으로 인정하면 한 글자 주제어가 너무 쉬워진다
        assertThat(DrawJudge.findAnswerRank("배", List.of("배구", "바다"))).isZero();
        assertThat(DrawJudge.findAnswerRank("배", List.of("배"))).isEqualTo(1);
    }

    @Test
    @DisplayName("응답 파싱 — JSON 배열을 앞뒤 설명과 함께 줘도 단어만 뽑는다")
    void parseGuessesJson() {
        assertThat(DrawJudge.parseGuesses("추측 결과: [\"사과\",\"수박\",\"공\",\"달\",\"바퀴\"] 입니다"))
                .containsExactly("사과", "수박", "공", "달", "바퀴");
    }

    @Test
    @DisplayName("응답 파싱 — 번호·불릿 목록으로 답해도 파싱하고 최대 5개까지만 쓴다")
    void parseGuessesLines() {
        assertThat(DrawJudge.parseGuesses("1. 사과\n2) 수박\n- 공")).containsExactly("사과", "수박", "공");
        assertThat(DrawJudge.parseGuesses("[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\"]"))
                .containsExactly("a", "b", "c", "d", "e");
    }

    @Test
    @DisplayName("응답 파싱 — 빈 응답은 빈 목록(채점 실패로 이어진다)")
    void parseGuessesEmpty() {
        assertThat(DrawJudge.parseGuesses(null)).isEmpty();
        assertThat(DrawJudge.parseGuesses("  ")).isEmpty();
    }
}
