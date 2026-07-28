package ssafy.a706.backend.decor.controller.dto;

import ssafy.a706.backend.decor.model.DecorAnchor;

import java.util.List;

/**
 * decor_setting.config의 JSON 형태. 클라이언트가 이 형태로 보내고 그대로 돌려받는다.
 *
 * <pre>
 * { "version": 1,
 *   "items": [ { "itemId": 3, "anchor": "FIXED", "x": 0.78, "y": 0.18, "scale": 0.22 } ] }
 * </pre>
 *
 * x·y는 영상 기준 정규화 좌표(0~1, 스티커 중심), scale은 영상 짧은 변 대비 비율이다.
 * 픽셀이 아니라 비율인 이유 — 카메라 해상도·타일 크기가 화면마다 달라서, 픽셀로 저장하면
 * 편집할 때와 게임 화면에서 위치가 어긋난다.
 */
public record DecorConfigPayload(int version, List<Placement> items) {

    public static final int CURRENT_VERSION = 1;

    public record Placement(Long itemId, DecorAnchor anchor, double x, double y, double scale) {}

    public static DecorConfigPayload empty() {
        return new DecorConfigPayload(CURRENT_VERSION, List.of());
    }

    public List<Placement> safeItems() {
        return items == null ? List.of() : items;
    }
}
