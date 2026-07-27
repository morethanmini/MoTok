package ssafy.a706.backend.report.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.report.enums.ReportReason;

/**
 * 사용자 신고 요청(-112, 명세 ReportRequest).
 *
 * <p>피신고자의 닉네임을 받지 않는 이유 — 클라이언트가 준 이름을 그대로 기록하면 아무 이름이나
 * 남길 수 있다. userId만 받아 서버가 조회해 스냅샷한다(채팅 신고가 원문을 Redis에서 직접 읽는 것과 같은 이유).</p>
 *
 * <p>{@code reasonType}은 명세상 문자열이지만 값은 {@link ReportReason} 코드다. 채팅 신고와
 * 사유 목록을 공유한다 — 같은 관리자 화면에서 함께 다루는데 어휘가 갈리면 통계도 갈린다.</p>
 */
public record UserReportCreateRequest(
        @NotNull Long reportedUserId,
        @NotNull ReportReason reasonType,
        @Size(max = 200) String reasonText
) {
}
