package ssafy.a706.backend.decor.controller.dto;

import ssafy.a706.backend.decor.model.DecorAnchor;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;

/**
 * decor_setting.config의 JSON 형태. 클라이언트가 이 형태로 보내고 그대로 돌려받는다.
 *
 * <pre>
 * { "version": 1,
 *   "items": [ { "itemId": 3, "anchor": "FIXED", "x": 0.78, "y": 0.18, "scale": 0.22 },
 *              { "itemId": 9, "anchor": "FRAME", "intensity": 0.5 } ] }
 * </pre>
 *
 * x·y는 영상 기준 정규화 좌표(0~1, 스티커 중심), scale은 영상 짧은 변 대비 비율이다.
 * 픽셀이 아니라 비율인 이유 — 카메라 해상도·타일 크기가 화면마다 달라서, 픽셀로 저장하면
 * 편집할 때와 게임 화면에서 위치가 어긋난다.
 *
 * <p>{@code intensity}는 FRAME 앵커(프레임 전체 효과)의 세기(0~1)다. scale을 세기로 겹쳐 쓰지
 * 않는 이유 — scale은 모든 자리에서 "영상 대비 크기"로 읽히는 값이라, 크기가 없는 효과에
 * 재사용하면 나중에 읽는 사람이 둘을 구분할 방법이 없다. 필드를 더하는 건 config가 JSON
 * 컬럼이라 스키마 변경이 아니고, 이 값을 모르는 옛 클라이언트는 그냥 무시한다.</p>
 *
 * <p><b>숫자 필드에 {@code Nulls.AS_EMPTY}를 거는 이유.</b> Jackson 3은
 * {@code FAIL_ON_NULL_FOR_PRIMITIVES}가 기본으로 켜져 있고, record는 <b>빠진 프로퍼티를 null로
 * 취급</b>한다. 그래서 이 표시가 없으면 {@code intensity} 하나가 빠진 요청이 본문 전체 파싱
 * 실패(400 COMMON_INVALID_INPUT)가 된다 — 스티커 하나 때문에 효과 세기까지 저장되지 않는다.
 * 좌표도 같은 함정이 있다: 자바스크립트의 NaN은 JSON을 거치면 {@code null}이 된다.
 * 빠진 숫자는 0으로 읽고 판정은 서비스의 clamp에 맡긴다 — 어차피 보내온 값을 그대로 믿지 않는다.</p>
 */
public record DecorConfigPayload(
        @JsonSetter(nulls = Nulls.AS_EMPTY) int version, List<Placement> items) {

    public static final int CURRENT_VERSION = 1;

    public record Placement(
            Long itemId,
            DecorAnchor anchor,
            @JsonSetter(nulls = Nulls.AS_EMPTY) double x,
            @JsonSetter(nulls = Nulls.AS_EMPTY) double y,
            @JsonSetter(nulls = Nulls.AS_EMPTY) double scale,
            @JsonSetter(nulls = Nulls.AS_EMPTY) double intensity) {}

    public static DecorConfigPayload empty() {
        return new DecorConfigPayload(CURRENT_VERSION, List.of());
    }

    public List<Placement> safeItems() {
        return items == null ? List.of() : items;
    }
}
