package ssafy.a706.backend.report;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.report.dto.ChatReportStatusUpdateRequest;
import ssafy.a706.backend.report.dto.UserReportListResponse;
import ssafy.a706.backend.report.enums.ReportStatus;

/**
 * 관리자 사용자 신고 조회·처리(-112).
 * 게스트·일반 회원 차단은 SecurityConfig(/api/v1/admin/** hasRole ADMIN)가 필터 단에서 처리한다.
 * 상태 변경 요청 본문은 채팅 신고와 같은 형태라 {@link ChatReportStatusUpdateRequest}를 그대로 쓴다.
 */
@RestController
@RequestMapping("/api/v1/admin/user-reports")
@RequiredArgsConstructor
public class UserReportAdminController {

    private final UserReportService userReportService;

    @GetMapping
    public ApiResponse<UserReportListResponse> list(
            @RequestParam(required = false) ReportStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(userReportService.list(status, page, size));
    }

    @PatchMapping("/{reportId}/status")
    public ApiResponse<Void> updateStatus(@PathVariable Long reportId,
                                          @Valid @RequestBody ChatReportStatusUpdateRequest request) {
        userReportService.updateStatus(reportId, request.status());
        return ApiResponse.ok("처리 상태 변경 완료");
    }
}
