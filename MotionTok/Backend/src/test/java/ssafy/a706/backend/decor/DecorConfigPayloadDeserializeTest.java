package ssafy.a706.backend.decor;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ssafy.a706.backend.decor.controller.dto.DecorConfigPayload;
import ssafy.a706.backend.decor.model.DecorAnchor;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * PUT /users/me/decoration 본문 파싱.
 *
 * <p>숫자 필드가 빠져도 400이 되지 않아야 한다. Jackson 3은 {@code FAIL_ON_NULL_FOR_PRIMITIVES}가
 * 기본으로 켜져 있고 record는 빠진 프로퍼티를 null로 보므로, 표시를 빼면 {@code intensity} 없는
 * 요청 하나가 본문 전체를 못 읽게 만든다(실제로 스티커를 새로 장착한 뒤 저장이 400이 됐다).</p>
 *
 * <p>애플리케이션이 쓰는 매퍼 설정과 무관하게 성립해야 하므로 기본 설정 매퍼로 검증한다 —
 * 전역 플래그가 아니라 DTO 자체가 관용적이어야 한다는 뜻이다.</p>
 */
class DecorConfigPayloadDeserializeTest {

    private final ObjectMapper mapper = JsonMapper.builder().build();

    @Test
    @DisplayName("intensity가 빠진 스티커 배치 — 0으로 읽는다")
    void missingIntensityReadsAsZero() {
        String json = """
                {"version":1,"items":[{"itemId":3,"anchor":"FIXED","x":0.78,"y":0.2,"scale":0.22}]}""";

        DecorConfigPayload payload = mapper.readValue(json, DecorConfigPayload.class);

        assertThat(payload.version()).isEqualTo(1);
        assertThat(payload.safeItems()).singleElement().satisfies(p -> {
            assertThat(p.itemId()).isEqualTo(3L);
            assertThat(p.anchor()).isEqualTo(DecorAnchor.FIXED);
            assertThat(p.x()).isEqualTo(0.78);
            assertThat(p.y()).isEqualTo(0.2);
            assertThat(p.scale()).isEqualTo(0.22);
            assertThat(p.intensity()).isZero();
        });
    }

    @Test
    @DisplayName("좌표가 null로 온 경우 — NaN이 JSON을 거치면 이 모양이 된다")
    void nullCoordinateReadsAsZero() {
        String json = """
                {"version":1,"items":[{"itemId":3,"anchor":"FIXED","x":null,"y":0.2,"scale":null}]}""";

        DecorConfigPayload payload = mapper.readValue(json, DecorConfigPayload.class);

        assertThat(payload.safeItems()).singleElement().satisfies(p -> {
            assertThat(p.x()).isZero();
            assertThat(p.scale()).isZero();
        });
    }

    @Test
    @DisplayName("version이 빠져도 읽는다 — 배치만 보내는 옛 클라이언트")
    void missingVersionReadsAsZero() {
        assertThatCode(() -> mapper.readValue("{\"items\":[]}", DecorConfigPayload.class))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("서버가 돌려준 응답을 그대로 다시 보내도 읽는다(왕복)")
    void roundTrip() {
        DecorConfigPayload original = new DecorConfigPayload(
                DecorConfigPayload.CURRENT_VERSION,
                List.of(
                        new DecorConfigPayload.Placement(3L, DecorAnchor.FIXED, 0.78, 0.2, 0.22, 0),
                        new DecorConfigPayload.Placement(9L, DecorAnchor.FRAME, 0, 0, 0, 0.5)));

        String json = mapper.writeValueAsString(original);

        assertThat(mapper.readValue(json, DecorConfigPayload.class)).isEqualTo(original);
    }
}
