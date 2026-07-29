package ssafy.a706.backend.global.text;

import org.springframework.stereotype.Component;

import java.text.Normalizer;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/**
 * 비속어 검사·마스킹 — FE {@code src/utils/profanity} 의 정규화를 그대로 포팅했다.
 *
 * <p>정규화 순서(소문자 → NFC → 공백/제로폭 제거 → 구분기호 제거 → 단독 자모 제거 → 숫자 제거
 * → 3회 이상 반복 축약)를 FE와 동일하게 유지해야 폼 선검사(FE)와 최종 판정(BE)이 일치한다.</p>
 *
 * <p>마스킹은 정규화 공간에서 사전 단어를 부분 문자열로 찾은 뒤, 각 정규화 문자가 원문(NFC)의
 * 어느 인덱스에서 왔는지 매핑을 되짚어 원문 구간을 {@code *}로 치환한다. 매칭 구간 사이에 낀
 * 우회용 삽입 문자(공백·구분기호·자모·숫자)와 반복 문자도 통째로 가려진다.
 * 예) {@code "시1발아"} → {@code "***아"}</p>
 */
@Component
public class ProfanityFilter {

    /** 정규화 결과. first/last[i] = 정규화 문자 i가 흡수한 원문(NFC) 구간의 시작/끝 인덱스. */
    private record Normalized(String text, int[] first, int[] last) {
    }

    /** 정규화된 사전 — 겹치는 매칭에서 긴 단어가 먼저 가려지도록 길이 내림차순. */
    private final List<String> normalizedWords;

    public ProfanityFilter(ProfanityWordlist wordlist) {
        // 정규화 결과가 1글자로 "줄어든" 항목(예: 숫자 우회형 "씨8" → "씨")은 부분 매칭에서
        // 정상 문장을 마구 가리므로 안전망으로 걸러낸다(사전 큐레이션 실수 방어).
        // 단, 원문부터 1글자인 항목(예: "좆")은 큐레이터가 의도한 것이므로 그대로 둔다.
        this.normalizedWords = wordlist.decodedWords().stream()
                .filter(w -> w.length() == 1 || normalize(w).text().length() >= 2)
                .map(w -> normalize(w).text())
                .filter(w -> !w.isEmpty())
                .distinct()
                .sorted(Comparator.comparingInt(String::length).reversed())
                .toList();
    }

    /** 텍스트에 사전 속 비속어가 포함되면 true. */
    public boolean contains(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        String normalized = normalize(text).text();
        for (String word : normalizedWords) {
            if (normalized.contains(word)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 비속어 구간을 같은 길이의 {@code *}로 치환한 문자열을 돌려준다. 없으면 NFC 적용본 그대로.
     * (NFC가 인덱스를 바꿀 수 있어 반환 기준 문자열은 항상 NFC 적용본이다 — 한글 입력은 사실상
     * 항상 NFC라 시각적 차이는 없다.)
     */
    public String mask(String text) {
        if (text == null || text.isEmpty()) {
            return text;
        }
        String nfc = Normalizer.normalize(text, Normalizer.Form.NFC);
        Normalized n = normalize(nfc);

        // 정규화 공간에서 사전 단어가 덮는 구간을 표시한다(단어끼리 겹쳐도 합집합으로 처리).
        boolean[] covered = new boolean[n.text().length()];
        boolean any = false;
        for (String word : normalizedWords) {
            int idx = n.text().indexOf(word);
            while (idx >= 0) {
                Arrays.fill(covered, idx, idx + word.length(), true);
                any = true;
                idx = n.text().indexOf(word, idx + 1);
            }
        }
        if (!any) {
            return nfc;
        }

        // 덮인 정규화 구간을 원문 구간으로 되돌려 치환한다.
        char[] out = nfc.toCharArray();
        int i = 0;
        while (i < covered.length) {
            if (!covered[i]) {
                i++;
                continue;
            }
            int j = i;
            while (j + 1 < covered.length && covered[j + 1]) {
                j++;
            }
            Arrays.fill(out, n.first()[i], n.last()[j] + 1, '*');
            i = j + 1;
        }
        return new String(out);
    }

    /**
     * 비교용 정규화 + 원문 인덱스 매핑. FE와 달리 정규식 치환이 아니라 문자 단위 순회지만,
     * 제거 대상이 전부 단일 문자 클래스라 결과는 동일하다. 소문자화는 길이가 변하지 않도록
     * 문자 단위 {@link Character#toLowerCase(char)}를 쓴다.
     */
    private Normalized normalize(String raw) {
        String nfc = Normalizer.normalize(raw, Normalizer.Form.NFC);

        // 1단계: 제거 대상(공백·구분기호·자모·숫자)을 걸러내며 원문 인덱스를 기억한다.
        StringBuilder kept = new StringBuilder(nfc.length());
        int[] keptIdx = new int[nfc.length()];
        int keptLen = 0;
        for (int i = 0; i < nfc.length(); i++) {
            char c = Character.toLowerCase(nfc.charAt(i));
            if (isRemovable(c)) {
                continue;
            }
            kept.append(c);
            keptIdx[keptLen++] = i;
        }

        // 2단계: 같은 문자 3회 이상 반복을 1회로 축약한다. 축약된 문자는 반복 구간 전체를 흡수한다.
        StringBuilder text = new StringBuilder(keptLen);
        int[] first = new int[keptLen];
        int[] last = new int[keptLen];
        int outLen = 0;
        int i = 0;
        while (i < keptLen) {
            int j = i;
            while (j + 1 < keptLen && kept.charAt(j + 1) == kept.charAt(i)) {
                j++;
            }
            if (j - i + 1 >= 3) {
                text.append(kept.charAt(i));
                first[outLen] = keptIdx[i];
                last[outLen] = keptIdx[j];
                outLen++;
            } else {
                for (int k = i; k <= j; k++) {
                    text.append(kept.charAt(k));
                    first[outLen] = keptIdx[k];
                    last[outLen] = keptIdx[k];
                    outLen++;
                }
            }
            i = j + 1;
        }
        return new Normalized(text.toString(),
                Arrays.copyOf(first, outLen), Arrays.copyOf(last, outLen));
    }

    /**
     * FE RE_SPACE·RE_SEP·RE_JAMO·RE_DIGIT 문자 클래스의 합집합.
     * 안 보이는 문자가 소스에 섞이지 않도록 비ASCII는 전부 16진 코드포인트로 비교한다(FE의 이스케이프 표기와 같은 취지).
     */
    private boolean isRemovable(char c) {
        // 공백 + 제로폭 — JS \s에 포함되는 NBSP류(00A0, 202F)를 명시적으로 더한다
        if (Character.isWhitespace(c) || c == 0x00A0 || c == 0x202F
                || (c >= 0x200B && c <= 0x200D) || c == 0xFEFF) {
            return true;
        }
        // 구분기호·점·각종 대시(2010-2015)·가운뎃점류(00B7, 2022, 2027, 30FB)·장음(30FC)·역슬래시·하이픈
        if (c == '.' || c == '_' || c == '*' || c == '~' || c == '|' || c == '/' || c == '\\' || c == '-'
                || (c >= 0x2010 && c <= 0x2015)
                || c == 0x00B7 || c == 0x2022 || c == 0x2027 || c == 0x30FB || c == 0x30FC) {
            return true;
        }
        // 음절 사이 낀 단독 한글 자모(우회용) — 첫가끝 자모·호환 자모·확장 자모
        if ((c >= 0x1100 && c <= 0x11FF) || (c >= 0x3130 && c <= 0x318F)
                || (c >= 0xA960 && c <= 0xA97F) || (c >= 0xD7B0 && c <= 0xD7FF)) {
            return true;
        }
        // 음절 사이 낀 숫자(반각+전각, 우회용)
        return (c >= '0' && c <= '9') || (c >= 0xFF10 && c <= 0xFF19);
    }
}
