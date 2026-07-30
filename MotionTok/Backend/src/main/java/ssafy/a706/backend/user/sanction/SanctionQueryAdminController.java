package ssafy.a706.backend.user.sanction;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.user.sanction.dto.SanctionHistoryListResponse;
import ssafy.a706.backend.user.sanction.dto.SanctionedReportsResponse;

import java.util.List;

/**
 * 제재를 <b>신고 기준으로</b> 되짚는 조회. 대상 회원이 정해져 있는 부과·해제({@link UserSanctionAdminController})와
 * 달리 경로에 userId가 없어 컨트롤러를 나눴다.
 *
 * <p>인가는 SecurityConfig가 {@code /api/v1/admin/**}로 일괄 처리한다.</p>
 */
@RestController
@RequestMapping("/api/v1/admin/sanctions")
@RequiredArgsConstructor
public class SanctionQueryAdminController {

    private final UserSanctionService userSanctionService;

    /**
     * GET /v1/admin/sanctions?userId=&type=&page=&size= — 제재 내역 전체 목록(최신순).
     *
     * <p>대상 회원을 정해야 하는 {@code /v1/admin/users/{userId}/sanctions}와 짝이다. 그쪽은
     * "이 사람이 무슨 제재를 받아 왔나"에 답하고, 이쪽은 <b>"요즘 무슨 제재가 나갔나"</b>에 답한다 —
     * 신고에서 사용자로 들어가는 흐름 밖에서 운영을 점검하려면 후자가 필요하다.</p>
     *
     * <p>{@code userId}·{@code type}은 선택이다. 둘 다 없으면 전체를 최신순으로 준다.</p>
     */
    @GetMapping
    public ApiResponse<SanctionHistoryListResponse> history(
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) SanctionType type,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(userSanctionService.searchHistory(userId, type, page, size));
    }

    /**
     * GET /v1/admin/sanctions/reports?type=USER_REPORT&reportIds=1,2,3
     *
     * <p>신고 목록의 "제재됨" 배지용. 한 페이지분 id를 한 번에 묶어 물어본다 —
     * 행마다 조회하면 페이지 크기만큼 요청이 나간다.</p>
     */
    @GetMapping("/reports")
    public ApiResponse<SanctionedReportsResponse> sanctionedReports(
            @RequestParam SanctionRefType type,
            @RequestParam(required = false) List<Long> reportIds) {
        return ApiResponse.ok(SanctionedReportsResponse.of(
                userSanctionService.sanctionedReportIds(type, reportIds)));
    }
}
