package ssafy.a706.backend.shop.service.ai;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * application.yaml 기본값이 <b>GPU 워커와 같은 조건</b>인지.
 *
 * <p>CI 변수를 하나도 등록하지 않은 상태가 우리 운영 기본값이라, 이 파일의 기본값이 곧 실제
 * 생성 조건이다. 두 경로(GPU·fal)의 조건이 어긋나면 유저에게는 "어떤 날은 이상하게 나온다"로
 * 보이고, 호출은 어느 쪽이든 200이라 실물을 봐야만 알 수 있다.</p>
 *
 * <p>값을 일부러 바꿀 때 이 테스트가 걸리는 건 정상이다 — 워커 쪽도 같이 바꿨는지 확인하라는
 * 뜻이다. 워커를 안 바꿀 거면 CI 변수로만 덮어쓰면 된다.</p>
 */
@SpringBootTest
class FalPropertiesDefaultsTest {

    @Autowired
    private FalProperties properties;

    @Test
    @DisplayName("워커와 같은 Lightning LoRA를 4스텝·guidance 1로 얹는다")
    void matchesWorkerGenerationSettings() {
        assertThat(properties.usesLora()).isTrue();
        // 파일명부터 4steps 전용이다 — 스텝 수와 이 파일은 함께 움직인다
        assertThat(properties.loraPath())
                .endsWith("Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors");
        assertThat(properties.loraScale()).isEqualTo(1.0);
        assertThat(properties.steps()).isEqualTo(4);
        // 증류 LoRA는 CFG가 접혀 있다(워커 true_cfg_scale=1.0)
        assertThat(properties.guidanceScale()).isEqualTo(1.0);
    }

    @Test
    @DisplayName("loras를 받는 엔드포인트다 — 기본 엔드포인트로 보내면 조용히 무시된다")
    void pointsAtLoraEndpoint() {
        assertThat(properties.endpoint()).endsWith("/lora");
    }

    @Test
    @DisplayName("프롬프트에 없는 얼굴을 그리지 말라는 지시가 들어 있다")
    void keepsFaceGuardrails() {
        assertThat(properties.prompt())
                .contains("If the sketch has no eyes, mouth, or face, do not add any.")
                .contains("Inanimate shapes must stay inanimate objects.")
                .contains("plain white background");
    }
}
