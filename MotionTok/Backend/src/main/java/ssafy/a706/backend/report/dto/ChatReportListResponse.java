package ssafy.a706.backend.report.dto;

import org.springframework.data.domain.Page;
import ssafy.a706.backend.report.ChatReport;

import java.util.List;

/** 관리자 신고 목록(-133) 페이지 응답. */
public record ChatReportListResponse(
        List<ChatReportSummaryResponse> reports,
        int page,
        int size,
        long totalElements,
        int totalPages
) {

    public static ChatReportListResponse from(Page<ChatReport> result) {
        return new ChatReportListResponse(
                result.getContent().stream().map(ChatReportSummaryResponse::from).toList(),
                result.getNumber(), result.getSize(),
                result.getTotalElements(), result.getTotalPages());
    }
}
