package ssafy.a706.backend.global.text;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * FE {@code src/__tests__/profanity.spec.ts} 케이스 이식 + 마스킹(원문 인덱스 복원) 케이스.
 * 욕설 원문을 소스에 남기지 않으려고 FE 테스트와 같은 base64 헬퍼를 쓴다.
 */
class ProfanityFilterTest {

    private static ProfanityFilter filter;

    @BeforeAll
    static void setUp() {
        filter = new ProfanityFilter(new ProfanityWordlist());
    }

    private static String d(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }

    @Test
    @DisplayName("빈 값·무해한 문장은 통과한다")
    void cleanTextPasses() {
        assertThat(filter.contains(null)).isFalse();
        assertThat(filter.contains("")).isFalse();
        assertThat(filter.contains("신나는 토요일 모션파티")).isFalse();
        assertThat(filter.contains("개발자 모임")).isFalse(); // '개발'은 사전과 겹치지 않음
    }

    @Test
    @DisplayName("사전 항목이 포함되면 잡는다")
    void detectsDictionaryWords() {
        assertThat(filter.contains(d("6rCc7IOI64G8") + " 방")).isTrue(); // 한국어 사전 항목
        assertThat(filter.contains(d("7IOI64G8") + " 모임")).isTrue(); // 단독 2글자 사전 항목
        assertThat(filter.contains(d("67OR7Iug") + "들 모여라")).isTrue(); // 한국어 사전 항목
        assertThat(filter.contains("this is " + d("c2hpdA=="))).isTrue(); // 영어 사전 항목
    }

    @Test
    @DisplayName("삽입 문자(공백·구분기호·자모·숫자) 우회를 잡는다")
    void detectsInsertionBypass() {
        String k0 = d("6rCc7IOI"); // 사전 항목 앞 2음절
        String k1 = d("64G8"); // 사전 항목 마지막 음절
        assertThat(filter.contains(k0 + " " + k1)).isTrue(); // 사이 공백
        assertThat(filter.contains(k0 + "-" + k1)).isTrue(); // 사이 구분기호
        assertThat(filter.contains(k0 + "ㅡ" + k1)).isTrue(); // 사이 단독 자모(ㅡ) 삽입
        assertThat(filter.contains(k0 + "1" + k1)).isTrue(); // 사이 숫자 삽입
        assertThat(filter.contains(k0 + "９" + k1)).isTrue(); // 사이 전각 숫자 삽입
    }

    @Test
    @DisplayName("대소문자·과장 반복 우회를 잡는다")
    void detectsCaseAndRepeatBypass() {
        String ew = d("c2hpdA=="); // 영어 사전 항목
        assertThat(filter.contains(ew.toUpperCase())).isTrue(); // 대문자
        assertThat(filter.contains(ew.charAt(0) + String.valueOf(ew.charAt(1)).repeat(3) + ew.substring(2)))
                .isTrue(); // 과장 반복
    }

    @Test
    @DisplayName("마스킹 — 매칭 구간을 같은 길이의 *로 치환하고 나머지는 보존한다")
    void maskReplacesOnlyMatchedSpan() {
        String w = d("7Iuc67Cc"); // 2음절 사전 항목
        assertThat(filter.mask("아 " + w + " 진짜")).isEqualTo("아 ** 진짜");
        assertThat(filter.mask(w + "아")).isEqualTo("**아");
    }

    @Test
    @DisplayName("마스킹 — 삽입 문자·반복 문자를 포함한 원문 구간을 통째로 가린다")
    void maskCoversBypassSpan() {
        String w = d("7Iuc67Cc"); // 2음절 사전 항목
        // 사이 숫자 삽입: 3글자 통째로
        assertThat(filter.mask(w.charAt(0) + "1" + w.charAt(1) + "아")).isEqualTo("***아");
        // 과장 반복: 반복 구간 전체
        String ew = d("c2hpdA==");
        String stretched = ew.charAt(0) + String.valueOf(ew.charAt(1)).repeat(3) + ew.substring(2);
        assertThat(filter.mask(stretched + " happens")).isEqualTo("*".repeat(stretched.length()) + " happens");
    }

    @Test
    @DisplayName("마스킹 — 무해한 텍스트는 그대로 돌려준다")
    void maskKeepsCleanText() {
        assertThat(filter.mask("좋은 하루 되세요")).isEqualTo("좋은 하루 되세요");
        assertThat(filter.mask("개발자 모임")).isEqualTo("개발자 모임");
        assertThat(filter.mask(null)).isNull();
        assertThat(filter.mask("")).isEmpty();
    }

    @Test
    @DisplayName("contains와 mask 판정은 일치한다")
    void containsMatchesMask() {
        String[] samples = {
                "신나는 토요일 모션파티",
                d("6rCc7IOI64G8") + " 방",
                "아 " + d("7Iuc67Cc") + " 진짜",
                "개발자 모임",
        };
        for (String s : samples) {
            assertThat(filter.contains(s))
                    .as("sample: %s", s)
                    .isEqualTo(!filter.mask(s).equals(s));
        }
    }
}
