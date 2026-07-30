package ssafy.a706.backend.user.sanction.dto;

import java.util.Collection;
import java.util.List;

/**
 * 물어본 신고들 중 제재로 이어진 것의 id.
 *
 * <p>부울 하나짜리 맵이 아니라 <b>제재된 id만</b> 돌려준다 — 대부분의 신고는 제재로 가지 않아
 * 응답이 훨씬 작고, 클라이언트는 집합 포함 여부만 보면 된다. 물어보지 않은 id는 응답에 없다.</p>
 */
public record SanctionedReportsResponse(List<Long> sanctionedReportIds) {

    public static SanctionedReportsResponse of(Collection<Long> ids) {
        return new SanctionedReportsResponse(List.copyOf(ids));
    }
}
