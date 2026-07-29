package ssafy.a706.backend.user.sanction.dto;

import org.springframework.data.domain.Page;
import ssafy.a706.backend.user.sanction.SanctionHistory;

import java.util.List;

/** 제재 이력 페이지 응답 — 신고 목록(UserReportListResponse)과 같은 형태. */
public record SanctionHistoryListResponse(
        List<SanctionHistoryResponse> sanctions,
        int page,
        int size,
        long totalElements,
        int totalPages
) {

    public static SanctionHistoryListResponse from(Page<SanctionHistory> result) {
        return new SanctionHistoryListResponse(
                result.getContent().stream().map(SanctionHistoryResponse::from).toList(),
                result.getNumber(), result.getSize(),
                result.getTotalElements(), result.getTotalPages());
    }
}
