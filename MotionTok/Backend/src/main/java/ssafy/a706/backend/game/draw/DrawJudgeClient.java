package ssafy.a706.backend.game.draw;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;

/**
 * GMS 비전 모델 호출 — 완성 그림을 보고 "무엇을 그린 것인지" 추측 5개를 받는다.
 *
 * <p><b>주제어는 프롬프트에 절대 넣지 않는다</b> — 블라인드 채점이 게임의 핵심 규칙이라,
 * 모델은 정답을 모른 채 그림만 보고 추측해야 한다.</p>
 *
 * <p>MVC(블로킹) 컨텍스트라 block()으로 동기 호출하며, 응답은 Jackson 버전 차이를 타지 않게
 * Map으로 파싱한다(소셜 로그인 클라이언트와 같은 방식).</p>
 */
@Slf4j
@Component
public class DrawJudgeClient {

    private static final String JUDGE_PROMPT =
            "이 그림이 무엇을 그린 것인지 가능성 높은 순으로 5개 추측해줘. "
                    + "각 추측은 한국어 명사 한 단어로만 하고, 다른 설명 없이 JSON 배열로만 답해줘. "
                    + "예시: [\"사과\",\"수박\",\"공\",\"달\",\"바퀴\"]";

    private final WebClient gmsWebClient;
    private final ObjectMapper objectMapper;
    private final GmsProperties properties;

    public DrawJudgeClient(WebClient gmsWebClient, ObjectMapper objectMapper, GmsProperties properties) {
        this.gmsWebClient = gmsWebClient;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    public boolean available() {
        return properties.configured();
    }

    /**
     * @param imageDataUrl PNG data URL (data:image/png;base64,...)
     * @return 가능성 높은 순 추측(최대 5개)
     */
    public List<String> guess(String imageDataUrl) {
        if (!available()) {
            throw new BusinessException(ErrorCode.GAME_JUDGE_UNAVAILABLE,
                    "AI 채점 설정(GMS_API_KEY·GMS_MODEL)이 없어 채점할 수 없습니다.");
        }
        Map<String, Object> body = Map.of(
                "model", properties.model(),
                "messages", List.of(Map.of(
                        "role", "user",
                        "content", List.of(
                                Map.of("type", "text", "text", JUDGE_PROMPT),
                                Map.of("type", "image_url", "image_url", Map.of("url", imageDataUrl))))));

        String raw = exchange(body);
        List<String> guesses = DrawJudge.parseGuesses(extractContent(raw));
        if (guesses.isEmpty()) {
            throw new BusinessException(ErrorCode.GAME_JUDGE_FAILED, "AI 응답에서 추측을 읽지 못했습니다.");
        }
        return guesses;
    }

    private String exchange(Map<String, Object> body) {
        try {
            return gmsWebClient.post()
                    .uri(properties.apiUrl())
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + properties.apiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();
        } catch (WebClientResponseException e) {
            // 키·모델·쿼터 문제를 로그에서 바로 가릴 수 있게 상태코드와 본문을 남긴다.
            log.warn("GMS judge call failed: status={} body={}", e.getStatusCode(), e.getResponseBodyAsString());
            throw new BusinessException(ErrorCode.GAME_JUDGE_FAILED, "AI 채점 요청이 실패했습니다. (" + e.getStatusCode() + ")");
        } catch (Exception e) {
            log.warn("GMS judge call failed", e);
            throw new BusinessException(ErrorCode.GAME_JUDGE_FAILED, "AI 채점 요청이 실패했습니다.");
        }
    }

    /** OpenAI 호환 응답에서 choices[0].message.content만 꺼낸다. */
    @SuppressWarnings("unchecked")
    private String extractContent(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        try {
            Map<String, Object> parsed = objectMapper.readValue(raw, Map.class);
            List<Object> choices = (List<Object>) parsed.get("choices");
            if (choices == null || choices.isEmpty()) {
                return "";
            }
            Map<String, Object> message = (Map<String, Object>) ((Map<String, Object>) choices.get(0)).get("message");
            Object content = message == null ? null : message.get("content");
            return content == null ? "" : content.toString();
        } catch (Exception e) {
            log.warn("GMS judge response parse failed", e);
            return "";
        }
    }
}
