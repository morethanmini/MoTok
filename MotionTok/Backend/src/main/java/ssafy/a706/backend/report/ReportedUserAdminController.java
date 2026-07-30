package ssafy.a706.backend.report;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.report.dto.ReportedUserResponse;

import java.util.List;

/**
 * 신고 유저 목록 (-105) — 두 신고 도메인을 합쳐 보는 관리자 조회.
 *
 * <p>{@code /admin/user-reports}·{@code /admin/chat-reports}는 <b>신고 한 건</b>이 단위지만
 * 이 목록은 <b>사람</b>이 단위다. 관리자 흐름이 다르다 — 신고함은 들어온 것을 처리하는 자리고,
 * 이 목록은 "누구를 봐야 하나"를 고르는 자리다.</p>
 *
 * <p>인가는 SecurityConfig가 {@code /api/v1/admin/**}로 일괄 처리한다.</p>
 */
@RestController
@RequestMapping("/api/v1/admin/reports")
@RequiredArgsConstructor
public class ReportedUserAdminController {

    private final ReportedUserQueryService reportedUserQueryService;

    /**
     * GET /v1/admin/reports?limit=20 — 누적 신고 횟수순 사용자 목록.
     *
     * <p>페이지가 아니라 상한이다 — 이 화면은 "많이 신고당한 사람"을 보는 곳이라 뒤쪽 페이지를
     * 넘길 이유가 없다. 상한을 두는 이유는 집계가 전체 스캔이기 때문이다(최대 100).</p>
     */
    @GetMapping
    public ApiResponse<List<ReportedUserResponse>> topReportedUsers(
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(reportedUserQueryService.topReportedUsers(limit));
    }
}
