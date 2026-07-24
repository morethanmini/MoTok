package ssafy.a706.backend.report.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.report.enums.ReportReason;

/**
 * 채팅 신고 요청 — 대상 지목(roomId+chatId)과 사유만 받는다.
 * 채팅 원문·작성자는 클라이언트를 신뢰하지 않고 서버가 Redis에서 직접 읽는다(조작 신고 차단).
 */
public record ChatReportCreateRequest(
        @NotBlank String roomId,
        @NotBlank String chatId,
        @NotNull ReportReason reason,
        @Size(max = 200) String detail
) {
}
