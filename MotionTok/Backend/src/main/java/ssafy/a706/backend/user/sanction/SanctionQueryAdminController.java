package ssafy.a706.backend.user.sanction;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.global.response.ApiResponse;
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
