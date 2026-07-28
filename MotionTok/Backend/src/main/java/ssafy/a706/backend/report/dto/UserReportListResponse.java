package ssafy.a706.backend.report.dto;

import org.springframework.data.domain.Page;
import ssafy.a706.backend.report.UserReport;

import java.util.List;

/** 관리자 사용자 신고 목록(-112) 페이지 응답 — 채팅 신고(-133)와 같은 형태. */
public record UserReportListResponse(
        List<UserReportSummaryResponse> reports,
        int page,
        int size,
        long totalElements,
        int totalPages
) {

    public static UserReportListResponse from(Page<UserReport> result) {
        return new UserReportListResponse(
                result.getContent().stream().map(UserReportSummaryResponse::from).toList(),
                result.getNumber(), result.getSize(),
                result.getTotalElements(), result.getTotalPages());
    }
}
