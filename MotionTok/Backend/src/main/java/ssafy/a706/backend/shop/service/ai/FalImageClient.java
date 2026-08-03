package ssafy.a706.backend.shop.service.ai;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import ssafy.a706.backend.shop.model.ItemCategory;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * fal 이미지 편집 호출 — 낙서(스케치)를 아이템 그림으로 바꾼다.
 *
 * <p><b>동기 호스트를 쓴다.</b> 문서화된 큐(https://queue.fal.run)는 요청 후 status/response를
 * 폴링하는 2단계인데, 우리는 이미 전용 스레드에서 기다리는 구조라 한 번에 끝나는 쪽이 코드도
 * 실패 지점도 적다.</p>
 *
 * <p><b>{@code sync_mode: true}로 data URI를 받는다.</b> 기본값은 결과 이미지의 URL을 주는데,
 * 그러면 우리가 그 URL을 한 번 더 받아 와야 한다. data URI로 받으면 기존
 * {@code AiItemJobService.complete(jobId, base64)}에 그대로 넘길 수 있어 저장·상태 전이 경로가
 * GPU 워커와 완전히 같아진다.</p>
 *
 * <p>입력 필드는 {@code image_urls}(배열)다 — 단수 {@code image_url}이 아니다. 스케치는
 * data URI 한 장으로 넣는다.</p>
 *
 * <p><b>워커와 같은 Lightning LoRA를 얹는다.</b> 기본 엔드포인트에는 {@code loras} 필드가 없지만
 * {@code fal-ai/qwen-image-edit-2511/lora}는 입력 스키마가 같고 세 필드만 더 받는다. LoRA 없이
 * fal 기본값(28스텝 · guidance 4.5)으로 돌리면 자유도가 커서 모델이 원본에서 멀어지고 <b>같은
 * 낙서로 다시 생성할 때마다 자기가 아는 얼굴을 새로 그려 버린다</b> — 워커 결과가 매번 비슷한
 * 이유가 4스텝이라 다듬는 것 말곤 할 게 없어서였다. 세 필드는 {@link FalProperties#usesLora()}에
 * 적힌 대로 한 세트로만 켠다.</p>
 */
@Slf4j
@Component
public class FalImageClient {

    /** 요청 인증 — fal은 Bearer가 아니라 "Key {FAL_KEY}" 형식이다. */
    private static final String AUTH_PREFIX = "Key ";

    /** 결과는 PNG로 받는다 — UploadPurpose.AI_ITEM이 png/webp만 허용하고 워커도 PNG로 보낸다. */
    private static final String OUTPUT_FORMAT = "png";

    /** 프롬프트에서 아이템 분류로 치환되는 자리 표시. */
    private static final String CATEGORY_TOKEN = "{category}";

    /** loras를 받는 엔드포인트의 꼬리 — 기본 엔드포인트에는 그 필드가 없다. */
    private static final String LORA_ENDPOINT_SUFFIX = "/lora";

    private final WebClient falWebClient;
    private final FalProperties properties;

    public FalImageClient(WebClient falWebClient, FalProperties properties) {
        this.falWebClient = falWebClient;
        this.properties = properties;
        if (properties.configured()) {
            // 어떤 조건으로 도는지 기동 때 한 줄 남긴다 — 설정을 바꿨는데 결과가 그대로일 때
            // 제일 먼저 의심할 것이 "새 설정으로 뜬 게 맞나"다.
            log.info("fal 생성 조건 — {} · {}", properties.endpoint(), settings());
        }
        warnIfLoraEndpointMismatch();
    }

    /**
     * LoRA를 쓰기로 해 놓고 엔드포인트가 {@code /lora}가 아니면 그 필드는 조용히 버려진다 —
     * 호출은 200으로 성공하고 결과만 나빠지니 실물을 보고도 원인을 짚기 어렵다. 기동 때 알린다.
     */
    private void warnIfLoraEndpointMismatch() {
        if (properties.usesLora() && !properties.endpoint().endsWith(LORA_ENDPOINT_SUFFIX)) {
            log.warn("LoRA를 설정했지만 엔드포인트가 {}로 끝나지 않습니다({}) — loras가 무시됩니다. "
                    + "FAL_MODEL을 fal-ai/qwen-image-edit-2511/lora로 두세요.",
                    LORA_ENDPOINT_SUFFIX, properties.endpoint());
        }
    }

    private String settings() {
        return properties.usesLora()
                ? "LoRA %s스텝 · guidance %s".formatted(properties.steps(), properties.guidanceScale())
                : "LoRA 없음 · fal 기본값(28스텝 · guidance 4.5)";
    }

    public boolean available() {
        return properties.configured();
    }

    /**
     * 스케치를 아이템 그림으로 바꾼다.
     *
     * @param sketchBase64 스케치 PNG의 base64(접두사 없음) — data URI로 감싸 보낸다
     * @return 생성 결과 PNG의 base64(접두사 없음)
     * @throws FalGenerationException 호출 실패·응답 형식 불일치·안전 필터 차단
     */
    public String edit(ItemCategory category, String sketchBase64) {
        Map<?, ?> response;
        try {
            response = falWebClient.post()
                    .uri(properties.endpoint())
                    .header(HttpHeaders.AUTHORIZATION, AUTH_PREFIX + properties.apiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(requestBody(category, sketchBase64))
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();
        } catch (RuntimeException e) {
            // 타임아웃·4xx·5xx를 한 종류로 묶는다 — 호출부는 "실패"만 알면 되고 사유는 로그로 남는다.
            throw new FalGenerationException("fal 호출 실패: " + e.getMessage(), e);
        }
        if (response == null) {
            throw new FalGenerationException("fal 응답이 비어 있습니다");
        }
        logResult(response);
        rejectIfUnsafe(response);
        return extractBase64(response);
    }

    /**
     * LoRA가 실제로 걸렸는지는 그림보다 <b>추론 시간</b>이 먼저 말해 준다 — 4스텝은 28스텝의
     * 몇 분의 1이다. 그림체만 보고는 "비슷한 것 같다"에서 더 나아가지 못한다.
     *
     * <p>{@code seed}도 같이 남긴다. 우리는 seed를 보내지 않으므로 매 호출 달라야 정상이고,
     * 같은 값이 반복되면 "다시 생성"이 같은 그림을 주는 이유가 그것이다.</p>
     */
    private void logResult(Map<?, ?> response) {
        log.info("fal 생성 완료 — timings {} · seed {} · {}",
                response.get("timings"), response.get("seed"), settings());
    }

    /** 보낼 필드를 고르는 부분만 따로 둔다 — 어떤 값이 함께 나가는지가 결과 품질을 좌우한다. */
    Map<String, Object> requestBody(ItemCategory category, String sketchBase64) {
        /*
         * image_size는 일부러 보내지 않는다 — 스펙상 생략하면 입력 이미지 크기를 그대로 쓴다.
         * 프론트가 낙서를 1024x1024로 키워 보내므로(인식률 때문에 그렇게 정해져 있다) 결과도
         * 1024가 된다. 여기서 작게 지정하면 형태가 무너지고, 스티커를 화면에서 크게 쓸 수도 없다
         * (StickerOverlay가 원본 픽셀을 확대 상한으로 쓴다).
         */
        Map<String, Object> body = new LinkedHashMap<>(Map.of(
                "prompt", properties.prompt().replace(CATEGORY_TOKEN, describe(category)),
                "image_urls", List.of("data:image/png;base64," + sketchBase64),
                "num_images", 1,
                "output_format", OUTPUT_FORMAT,
                // 결과를 URL이 아니라 data URI로 받는다(위 주석 참고)
                "sync_mode", true));
        // 비워 두면 아예 보내지 않는다 — 빈 문자열도 모델에는 지시가 되므로 기본값에 맡긴다.
        if (properties.negativePrompt() != null && !properties.negativePrompt().isBlank()) {
            body.put("negative_prompt", properties.negativePrompt());
        }
        /*
         * 세 필드는 함께 들어가거나 함께 빠진다(FalProperties.usesLora 주석 참고).
         * seed는 일부러 보내지 않는다 — 고정하면 "다시 생성"이 매번 같은 그림을 준다.
         */
        if (properties.usesLora()) {
            body.put("loras", List.of(Map.of(
                    "path", properties.loraPath(),
                    "scale", properties.loraScale())));
            body.put("num_inference_steps", properties.steps());
            body.put("guidance_scale", properties.guidanceScale());
        }
        return body;
    }

    /**
     * 안전 필터에 걸린 결과는 버린다. fal은 차단해도 200과 함께 이미지를 주는데(까맣게 지워진
     * 그림), 그걸 그대로 저장하면 유저는 "이상한 그림이 나왔다"로 받아들인다.
     */
    private void rejectIfUnsafe(Map<?, ?> response) {
        Object flags = response.get("has_nsfw_concepts");
        if (flags instanceof List<?> list && list.stream().anyMatch(Boolean.TRUE::equals)) {
            throw new FalGenerationException("생성 결과가 안전 필터에 걸렸습니다");
        }
    }

    /** images[0].url의 data URI에서 base64 본문만 떼어 낸다. */
    private String extractBase64(Map<?, ?> response) {
        if (!(response.get("images") instanceof List<?> images) || images.isEmpty()) {
            throw new FalGenerationException("fal 응답에 이미지가 없습니다");
        }
        if (!(images.get(0) instanceof Map<?, ?> first) || !(first.get("url") instanceof String url)) {
            throw new FalGenerationException("fal 응답 형식이 예상과 다릅니다");
        }
        int comma = url.indexOf(',');
        if (!url.startsWith("data:") || comma < 0) {
            // sync_mode를 무시하고 URL을 준 경우 — 조용히 넘기면 base64 자리에 URL이 들어가 깨진다.
            throw new FalGenerationException("fal이 data URI가 아닌 주소를 돌려줬습니다");
        }
        return url.substring(comma + 1);
    }

    private String describe(ItemCategory category) {
        return switch (category) {
            case STICKER -> "sticker";
            case MASK -> "face mask";
            case EFFECT -> "visual effect";
            case BACKGROUND -> "background";
        };
    }
}
