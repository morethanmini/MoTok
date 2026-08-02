package ssafy.a706.backend.decor.controller.dto;

import ssafy.a706.backend.decor.model.DecorAnchor;

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
 */
public record DecorConfigPayload(int version, List<Placement> items) {

    public static final int CURRENT_VERSION = 1;

    public record Placement(
            Long itemId, DecorAnchor anchor, double x, double y, double scale, double intensity) {}

    public static DecorConfigPayload empty() {
        return new DecorConfigPayload(CURRENT_VERSION, List.of());
    }

    public List<Placement> safeItems() {
        return items == null ? List.of() : items;
    }
}
