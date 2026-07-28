package ssafy.a706.backend.report.dto;

import ssafy.a706.backend.report.UserReport;
import ssafy.a706.backend.report.enums.ReportReason;
import ssafy.a706.backend.report.enums.ReportStatus;

import java.time.LocalDateTime;

/**
 * 관리자 사용자 신고 목록(-112) 행.
 * 닉네임은 신고 시점 스냅샷이라 그 뒤 닉네임이 바뀌거나 탈퇴해도 그대로 남는다.
 */
public record UserReportSummaryResponse(
        Long id,
        Long reporterUserId,
        String reporterNickname,
        Long reportedUserId,
        String reportedNickname,
        ReportReason reason,
        String reasonDetail,
        ReportStatus status,
        LocalDateTime createdAt
) {

    public static UserReportSummaryResponse from(UserReport report) {
        return new UserReportSummaryResponse(
                report.getId(),
                report.getReporterUserId(), report.getReporterNickname(),
                report.getReportedUserId(), report.getReportedNickname(),
                report.getReason(), report.getReasonDetail(),
                report.getStatus(), report.getCreatedAt());
    }
}
