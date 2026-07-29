package ssafy.a706.backend.user.sanction.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.user.sanction.SanctionRefType;

/**
 * 경고 부과 요청.
 *
 * <p>기간도 차단도 없어 본문이 사유와 근거뿐이다. <b>사유가 특히 중요한 제재다</b> —
 * 정지는 접근이 막히는 것으로 전달되지만 경고는 문구가 전달의 전부다.
 * "경고합니다" 한 줄만 남으면 당사자는 무엇을 고쳐야 하는지 알 수 없다.</p>
 *
 * @param reason     경고 사유. 이력에 남고 <b>당사자에게 그대로 보인다</b>.
 * @param reportId   근거가 된 신고 id. 직권이면 생략한다.
 * @param reportType 그 id가 어느 신고 테이블의 행인지. reportId와 짝이다.
 */
public record WarnUserRequest(
        @NotBlank @Size(max = 200) String reason,
        Long reportId,
        SanctionRefType reportType
) {

    @AssertTrue(message = "reportId와 reportType은 함께 지정해야 합니다")
    public boolean isReportRefPaired() {
        return (reportId == null) == (reportType == null);
    }
}
