package ssafy.a706.backend.game.draw;

import java.util.ArrayList;
import java.util.List;

/**
 * 그림으로 말해요 채점 판정 — AI 응답 파싱과 주제어 매칭(순수 함수, 외부 의존 없음).
 *
 * <p>원래 프론트에 있던 로직을 서버로 옮긴 것이다. 배포 환경에서는 GMS 키를 클라이언트에 둘 수
 * 없어 호출 주체가 서버가 됐고, 그러면서 <b>점수 계산도 서버 권위</b>가 됐다 — 클라이언트가
 * 임의 점수를 올려 보낼 수 있는 경로가 사라진다.</p>
 */
public final class DrawJudge {

    /** 추측 순위(1~5)별 점수 — 1순위 100점, 3순위 60점 … */
    private static final int[] RANK_SCORES = {100, 80, 60, 40, 20};
    public static final int MAX_GUESSES = 5;

    private DrawJudge() {
    }

    public static int scoreForRank(int rank) {
        return rank >= 1 && rank <= RANK_SCORES.length ? RANK_SCORES[rank - 1] : 0;
    }

    /** 비교용 정규화 — 공백·따옴표·구두점 제거 + 소문자화. */
    public static String normalize(String s) {
        if (s == null) {
            return "";
        }
        return s.toLowerCase()
                .replaceAll("[\"'`.,!?~()\\[\\]{}]", "")
                .replaceAll("\\s+", "");
    }

    /**
     * 주제어가 추측 목록의 몇 순위인지(1-based). 없으면 0.
     * 정확 일치 우선, 두 글자 이상일 때만 포함 관계도 인정한다
     * ("사과나무" 추측 ↔ 주제 "사과"는 정답, 주제 "배" ↔ 추측 "배구"는 오답).
     */
    public static int findAnswerRank(String topic, List<String> guesses) {
        String t = normalize(topic);
        if (t.isEmpty() || guesses == null) {
            return 0;
        }
        for (int i = 0; i < guesses.size(); i++) {
            String g = normalize(guesses.get(i));
            if (g.isEmpty()) {
                continue;
            }
            if (g.equals(t)
                    || (t.length() >= 2 && g.contains(t))
                    || (g.length() >= 2 && t.contains(g))) {
                return i + 1;
            }
        }
        return 0;
    }

    /**
     * AI 응답 텍스트 → 추측 단어 목록(최대 5개).
     * JSON 배열 응답을 우선 파싱하고, 아니면 "1. 사과" / "- 사과" 형태의 줄 목록으로 파싱한다.
     * 모델이 형식을 안 지켜도 채점이 죽지 않게 하려는 방어라 파서를 직접 둔다.
     */
    public static List<String> parseGuesses(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        List<String> fromJson = parseJsonArray(text);
        if (!fromJson.isEmpty()) {
            return fromJson;
        }
        List<String> out = new ArrayList<>();
        for (String line : text.split("\\r?\\n")) {
            String word = line
                    .replaceAll("^\\s*(?:[-*•]|\\d+\\s*[.)순위:]+)\\s*", "")
                    .replaceAll("[\"'`]", "")
                    .trim();
            if (!word.isEmpty()) {
                out.add(word);
            }
            if (out.size() == MAX_GUESSES) {
                break;
            }
        }
        return List.copyOf(out);
    }

    /** 앞뒤 설명이 섞여 있어도 첫 번째 [ ... ] 블록만 떼어 따옴표 안 문자열을 뽑는다. */
    private static List<String> parseJsonArray(String text) {
        int start = text.indexOf('[');
        int end = text.indexOf(']', start + 1);
        if (start < 0 || end < 0) {
            return List.of();
        }
        String body = text.substring(start + 1, end);
        List<String> out = new ArrayList<>();
        for (String raw : body.split(",")) {
            String word = raw.replaceAll("[\"'`]", "").trim();
            if (!word.isEmpty()) {
                out.add(word);
            }
            if (out.size() == MAX_GUESSES) {
                break;
            }
        }
        return List.copyOf(out);
    }
}
