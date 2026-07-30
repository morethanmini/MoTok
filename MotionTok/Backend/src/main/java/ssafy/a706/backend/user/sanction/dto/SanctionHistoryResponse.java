package ssafy.a706.backend.user.sanction.dto;

import ssafy.a706.backend.user.sanction.SanctionHistory;
import ssafy.a706.backend.user.sanction.SanctionRefType;
import ssafy.a706.backend.user.sanction.SanctionType;

import java.time.LocalDateTime;

/** 제재 이력 한 줄. 닉네임은 제재 시점 스냅샷이라 그 뒤 바뀌어도 그대로 남는다. */
public record SanctionHistoryResponse(
        Long id,
        Long userId,
        String userNickname,
        Long adminUserId,
        String adminNickname,
        SanctionType type,
        Integer days,
        String reason,
        Long refReportId,
        /** 위 id가 어느 신고인지. 직권 제재면 id와 함께 null이라 화면은 "직권"으로 표시한다. */
        SanctionRefType refReportType,
        LocalDateTime createdAt
) {

    public static SanctionHistoryResponse from(SanctionHistory history) {
        return new SanctionHistoryResponse(
                history.getId(),
                history.getUserId(), history.getUserNickname(),
                history.getAdminUserId(), history.getAdminNickname(),
                history.getType(), history.getDays(), history.getReason(),
                history.getRefReportId(), history.getRefReportType(), history.getCreatedAt());
    }
}
