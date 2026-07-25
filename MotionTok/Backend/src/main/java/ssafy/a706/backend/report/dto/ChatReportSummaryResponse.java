package ssafy.a706.backend.report.dto;

import ssafy.a706.backend.report.ChatReport;
import ssafy.a706.backend.report.enums.ReportReason;
import ssafy.a706.backend.report.enums.ReportStatus;

import java.time.LocalDateTime;

/** 관리자 신고 목록(-133) 행 — 스냅샷 원문은 목록에도 그대로 노출한다(최대 500자). */
public record ChatReportSummaryResponse(
        Long id,
        String roomId,
        String reporterNickname,
        String reportedNickname,
        ReportReason reason,
        ReportStatus status,
        String reportedText,
        LocalDateTime createdAt
) {

    public static ChatReportSummaryResponse from(ChatReport report) {
        return new ChatReportSummaryResponse(report.getId(), report.getRoomId(),
                report.getReporterNickname(), report.getReportedNickname(),
                report.getReason(), report.getStatus(), report.getReportedText(),
                report.getCreatedAt());
    }
}
