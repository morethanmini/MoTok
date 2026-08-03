package ssafy.a706.backend.shop.service.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * application.yaml의 app.shop.fal.* — GPU 워커 대신 fal에 생성을 맡길 때 쓰는 설정.
 *
 * <p><b>키는 서버에만 둔다.</b> 프론트에 넣으면 번들에 그대로 노출돼 남이 우리 크레딧을 쓴다
 * (GMS 채점 키를 서버에만 두는 것과 같은 이유).</p>
 *
 * @param baseUrl        동기 호출 호스트. 큐(https://queue.fal.run)는 요청/폴링 2단계지만
 *                       이쪽은 한 번에 끝나 전용 스레드에서 그대로 기다리면 된다.
 * @param model          모델 엔드포인트 id (예: fal-ai/qwen-image-edit-2511/lora).
 *                       {@code loraPath}를 쓰려면 {@code /lora}로 끝나는 쪽이어야 한다 —
 *                       기본 엔드포인트에는 {@code loras} 필드가 없다.
 * @param apiKey         FAL_KEY. 비어 있으면 fal 경로를 아예 켜지 않는다.
 * @param prompt         생성 지시문. 결과 품질을 좌우하는 값이라 재빌드 없이 바꿀 수 있게 설정으로 뺐다.
 *                       {@code {category}}를 쓰면 아이템 분류(sticker·mask 등)로 치환된다.
 * @param negativePrompt 피하고 싶은 것(배경·글자 등). 비워 두면 보내지 않는다.
 * @param loraPath       얹을 LoRA의 safetensors 주소. 비우면 {@code loras}·{@code steps}·
 *                       {@code guidanceScale}을 <b>모두</b> 보내지 않고 fal 기본값에 맡긴다
 *                       (아래 {@link #usesLora()} 주석 참고).
 * @param loraScale      LoRA 적용 강도. 증류 LoRA는 1.0이 설계값이다.
 * @param steps          {@code num_inference_steps}. 워커가 쓰는 Lightning LoRA는 4스텝 전용이다.
 * @param guidanceScale  {@code guidance_scale}. 증류 LoRA는 CFG가 접혀 들어가 1.0으로 끈다.
 * @param handoverSeconds AUTO 모드에서 PENDING이 이 시간을 넘기면 fal이 넘겨받는다.
 *                       FAL 모드에서는 무시하고 즉시 가져간다.
 * @param dailyLimit     하루 호출 상한(0이면 무제한). 크레딧이 조용히 소진되는 걸 막는 안전핀이다 —
 *                       GPU가 죽은 채 방치되면 모든 요청이 fal로 흘러 하루 만에 바닥날 수 있다.
 */
@ConfigurationProperties(prefix = "app.shop.fal")
public record FalProperties(
        String baseUrl,
        String model,
        String apiKey,
        String prompt,
        String negativePrompt,
        String loraPath,
        double loraScale,
        int steps,
        double guidanceScale,
        int handoverSeconds,
        int dailyLimit) {

    public boolean configured() {
        return apiKey != null && !apiKey.isBlank() && model != null && !model.isBlank();
    }

    /**
     * LoRA·스텝·guidance는 <b>한 세트로만</b> 켜고 끈다.
     *
     * <p>따로 켜면 양쪽 다 망가진다. 4스텝 전용으로 증류된 LoRA에 28번 붓질을 시키는 것도,
     * LoRA 없이 4스텝만 도는 것도(노이즈가 안 걷힌다) 결과가 더 나빠진다. 그래서 LoRA 주소가
     * 비어 있으면 스텝·guidance도 보내지 않고 fal 기본값(28 / 4.5)에 맡긴다 —
     * 반쯤 설정된 상태가 생길 수 없게 한다.</p>
     */
    public boolean usesLora() {
        return loraPath != null && !loraPath.isBlank();
    }

    /** 동기 호출 주소 — 예: https://fal.run/fal-ai/qwen-image-edit-2511/lora */
    public String endpoint() {
        return "%s/%s".formatted(baseUrl.replaceAll("/+$", ""), model);
    }
}
