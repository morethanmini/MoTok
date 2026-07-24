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
import ssafy.a706.backend.report.dto.ChatReportDetailResponse;
import ssafy.a706.backend.report.dto.ChatReportListResponse;
import ssafy.a706.backend.report.dto.ChatReportStatusUpdateRequest;
import ssafy.a706.backend.report.enums.ReportStatus;

/**
 * 관리자 채팅 신고 조회·처리(-133).
 * 게스트·일반 회원 차단은 SecurityConfig(/api/v1/admin/** hasRole ADMIN)가 필터 단에서 처리한다.
 */
@RestController
@RequestMapping("/api/v1/admin/chat-reports")
@RequiredArgsConstructor
public class ChatReportAdminController {

    private final ChatReportService chatReportService;

    @GetMapping
    public ApiResponse<ChatReportListResponse> list(
            @RequestParam(required = false) ReportStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(chatReportService.list(status, page, size));
    }

    @GetMapping("/{reportId}")
    public ApiResponse<ChatReportDetailResponse> detail(@PathVariable Long reportId) {
        return ApiResponse.ok(chatReportService.detail(reportId));
    }

    @PatchMapping("/{reportId}/status")
    public ApiResponse<Void> updateStatus(@PathVariable Long reportId,
                                          @Valid @RequestBody ChatReportStatusUpdateRequest request) {
        chatReportService.updateStatus(reportId, request.status());
        return ApiResponse.ok("처리 상태 변경 완료");
    }
}
