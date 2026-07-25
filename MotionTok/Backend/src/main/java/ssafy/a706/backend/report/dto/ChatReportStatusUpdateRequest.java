package ssafy.a706.backend.report.dto;

import jakarta.validation.constraints.NotNull;
import ssafy.a706.backend.report.enums.ReportStatus;

/** 관리자 처리 상태 변경(-133). RECEIVED(초기 상태)로의 되돌림은 허용하지 않는다. */
public record ChatReportStatusUpdateRequest(@NotNull ReportStatus status) {
}
