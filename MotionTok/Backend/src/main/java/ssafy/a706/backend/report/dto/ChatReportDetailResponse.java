package ssafy.a706.backend.report.dto;

import ssafy.a706.backend.report.ChatReport;
import ssafy.a706.backend.report.enums.ReportReason;
import ssafy.a706.backend.report.enums.ReportStatus;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 관리자 신고 상세(-133). context는 저장된 스냅샷(JSON)을 파싱한 시간순 배열 —
 * 순서대로 렌더링하면 채팅창이 복원되고, chatId가 이 응답의 chatId와 일치하는 원소가 신고 대상이다.
 */
public record ChatReportDetailResponse(
        Long id,
        String roomId,
        String chatId,
        Long reporterUserId,
        String reporterNickname,
        Long reportedUserId,
        String reportedNickname,
        String reportedText,
        Instant reportedAt,
        ReportReason reason,
        String reasonDetail,
        ReportStatus status,
        List<ChatContextEntry> context,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {

    public static ChatReportDetailResponse of(ChatReport report, List<ChatContextEntry> context) {
        return new ChatReportDetailResponse(report.getId(), report.getRoomId(), report.getChatId(),
                report.getReporterUserId(), report.getReporterNickname(),
                report.getReportedUserId(), report.getReportedNickname(),
                report.getReportedText(), report.getReportedAt(),
                report.getReason(), report.getReasonDetail(), report.getStatus(),
                context, report.getCreatedAt(), report.getUpdatedAt());
    }
}
