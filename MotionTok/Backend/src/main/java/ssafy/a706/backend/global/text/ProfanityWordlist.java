package ssafy.a706.backend.global.text;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * 비속어 사전 로더 — resources/profanity/wordlist.json 이 단일 소스다.
 * FE 폼 선검사용 사전도 이 파일을 GET /api/v1/profanity/wordlist 로 받아 쓴다(번들 내장본은 폴백).
 *
 * 단어는 원문을 리포지토리에 평문으로 남기지 않으려고 base64(UTF-8)로 보관한다
 * (난독화 수준의 조치 — FE utils/profanity/wordlist.ts와 같은 관례).
 */
@Component
public class ProfanityWordlist {

    private static final String RESOURCE_PATH = "profanity/wordlist.json";

    private final JsonNode raw;
    private final List<String> decodedWords;

    public ProfanityWordlist() {
        try (InputStream in = new ClassPathResource(RESOURCE_PATH).getInputStream()) {
            this.raw = new ObjectMapper().readTree(in);
        } catch (IOException e) {
            throw new UncheckedIOException("비속어 사전 로드 실패: " + RESOURCE_PATH, e);
        }
        List<String> words = new ArrayList<>();
        for (JsonNode node : raw.path("words")) {
            words.add(new String(Base64.getDecoder().decode(node.asText()), StandardCharsets.UTF_8));
        }
        this.decodedWords = List.copyOf(words);
    }

    /** base64 디코딩된 원문 단어들. */
    public List<String> decodedWords() {
        return decodedWords;
    }

    /** 사전 파일 원본(JSON) — FE 서빙용. */
    public JsonNode raw() {
        return raw;
    }
}
