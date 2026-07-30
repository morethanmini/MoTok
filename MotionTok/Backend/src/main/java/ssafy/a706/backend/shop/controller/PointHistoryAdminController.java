package ssafy.a706.backend.shop.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.shop.controller.dto.AdminPointHistoryListResponse;
import ssafy.a706.backend.shop.model.PointDirection;
import ssafy.a706.backend.shop.model.PointHistoryType;
import ssafy.a706.backend.shop.service.PointHistoryAdminService;

/**
 * 관리자 포인트 내역 조회 (-106 후속).
 *
 * <p>인가는 SecurityConfig가 {@code /api/v1/admin/**}로 일괄 처리한다. 상점 API
 * ({@link ShopController}, {@code /api/shop/**})와 경로 계열이 다른 게 중요하다 — 저 경로는
 * hasRole("USER")라 관리자 조회를 거기 붙이면 일반 회원이 남의 내역을 읽는다.</p>
 */
@RestController
@RequestMapping("/api/v1/admin/points")
@RequiredArgsConstructor
public class PointHistoryAdminController {

    private final PointHistoryAdminService pointHistoryAdminService;

    /**
     * GET /v1/admin/points?userId=&direction=EARN|SPEND&type=&page=&size= — 포인트 내역(최신순).
     *
     * <p>모든 필터가 선택이다. {@code userId}를 주면 그 회원의 전체 적립·사용 합계와 현재 잔액이
     * {@code summary}로 함께 온다 — 안 주면 null이다(여러 사람을 합친 합계는 의미가 없다).</p>
     */
    @GetMapping
    public ApiResponse<AdminPointHistoryListResponse> history(
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) PointDirection direction,
            @RequestParam(required = false) PointHistoryType type,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(pointHistoryAdminService.search(userId, direction, type, page, size));
    }
}
