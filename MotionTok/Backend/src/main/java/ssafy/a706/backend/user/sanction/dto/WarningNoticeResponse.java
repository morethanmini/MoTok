package ssafy.a706.backend.user.sanction.dto;

import ssafy.a706.backend.user.sanction.SanctionHistory;

import java.time.LocalDateTime;

/**
 * 당사자에게 보여 줄 경고 한 건.
 *
 * <p>관리자용 {@link SanctionHistoryResponse}와 필드가 다르다 — <b>집행자 정보를 싣지 않는다.</b>
 * 어느 관리자가 내렸는지는 당사자가 알 필요가 없고, 알려 주면 개인에 대한 항의·보복의 대상이 된다.
 * 근거 신고 id도 뺀다: 그걸로 신고자를 역추적할 여지를 만들 이유가 없다.</p>
 */
public record WarningNoticeResponse(
        Long id,
        String reason,
        LocalDateTime createdAt
) {

    public static WarningNoticeResponse from(SanctionHistory history) {
        return new WarningNoticeResponse(history.getId(), history.getReason(), history.getCreatedAt());
    }
}
