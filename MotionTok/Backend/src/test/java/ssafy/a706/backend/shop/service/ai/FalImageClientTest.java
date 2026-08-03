package ssafy.a706.backend.shop.service.ai;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;
import ssafy.a706.backend.shop.model.ItemCategory;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * fal에 보내는 요청 본문 — <b>무엇이 함께 나가는지</b>를 못박는다.
 *
 * <p>여기서 지키는 건 LoRA·스텝·guidance가 <b>한 세트</b>라는 것이다. 셋 중 하나만 바뀌어도
 * 결과가 조용히 나빠진다 — LoRA 없이 fal 기본값(28스텝 · guidance 4.5)으로 돌면 모델이 원본에서
 * 멀어져 "다시 생성"할 때마다 얼굴을 새로 그려 버리고, 반대로 4스텝 전용 LoRA에 28스텝을 시키면
 * 그것도 더 나빠진다. 호출은 어느 쪽이든 200이라 테스트 없이는 실물을 봐야만 알 수 있다.</p>
 */
class FalImageClientTest {

    private static final String LORA =
            "https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/"
                    + "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors";

    private FalProperties properties(String loraPath, int steps, double guidance) {
        return new FalProperties(
                "https://fal.run", "fal-ai/qwen-image-edit-2511/lora", "key",
                "make a {category}", "", loraPath, 1.0, steps, guidance, 20, 120);
    }

    private Map<String, Object> bodyOf(FalProperties properties) {
        return new FalImageClient(WebClient.builder().build(), properties)
                .requestBody(ItemCategory.STICKER, "AAAA");
    }

    @Test
    @DisplayName("LoRA·스텝·guidance가 함께 나간다 — 워커와 같은 4스텝 조건")
    void sendsLoraSet() {
        Map<String, Object> body = bodyOf(properties(LORA, 4, 1.0));

        assertThat(body.get("loras")).isEqualTo(List.of(Map.of("path", LORA, "scale", 1.0)));
        assertThat(body.get("num_inference_steps")).isEqualTo(4);
        assertThat(body.get("guidance_scale")).isEqualTo(1.0);
    }

    @Test
    @DisplayName("LoRA 주소가 비면 스텝·guidance도 안 보낸다 — 4스텝만 남으면 노이즈가 걷히지 않는다")
    void omitsWholeSetWithoutLora() {
        Map<String, Object> body = bodyOf(properties("", 4, 1.0));

        assertThat(body).doesNotContainKeys("loras", "num_inference_steps", "guidance_scale");
    }

    @Test
    @DisplayName("seed는 보내지 않는다 — 고정하면 '다시 생성'이 매번 같은 그림을 준다")
    void neverSendsSeed() {
        assertThat(bodyOf(properties(LORA, 4, 1.0))).doesNotContainKey("seed");
    }

    @Test
    @DisplayName("결과는 data URI로 받고 크기는 입력을 따른다")
    void keepsSyncModeAndInputSize() {
        Map<String, Object> body = bodyOf(properties(LORA, 4, 1.0));

        assertThat(body.get("sync_mode")).isEqualTo(true);
        assertThat(body.get("output_format")).isEqualTo("png");
        assertThat(body.get("image_urls")).isEqualTo(List.of("data:image/png;base64,AAAA"));
        // image_size를 지정하면 형태가 무너지고 스티커를 크게 쓸 수도 없다
        assertThat(body).doesNotContainKey("image_size");
    }

    @Test
    @DisplayName("{category}는 아이템 분류로 치환된다")
    void replacesCategoryToken() {
        assertThat(bodyOf(properties(LORA, 4, 1.0)).get("prompt")).isEqualTo("make a sticker");
    }

    @Test
    @DisplayName("빈 negative_prompt는 보내지 않는다 — 빈 문자열도 모델에는 지시가 된다")
    void omitsBlankNegativePrompt() {
        assertThat(bodyOf(properties(LORA, 4, 1.0))).doesNotContainKey("negative_prompt");
    }

    @Test
    @DisplayName("엔드포인트는 base-url + model")
    void buildsEndpoint() {
        assertThat(properties(LORA, 4, 1.0).endpoint())
                .isEqualTo("https://fal.run/fal-ai/qwen-image-edit-2511/lora");
    }
}
