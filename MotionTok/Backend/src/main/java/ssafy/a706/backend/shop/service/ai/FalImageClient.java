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

    private final WebClient falWebClient;
    private final FalProperties properties;

    public FalImageClient(WebClient falWebClient, FalProperties properties) {
        this.falWebClient = falWebClient;
        this.properties = properties;
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

        Map<?, ?> response;
        try {
            response = falWebClient.post()
                    .uri(properties.endpoint())
                    .header(HttpHeaders.AUTHORIZATION, AUTH_PREFIX + properties.apiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
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
        rejectIfUnsafe(response);
        return extractBase64(response);
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
