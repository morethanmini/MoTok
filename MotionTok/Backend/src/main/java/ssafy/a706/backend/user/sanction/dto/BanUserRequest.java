package ssafy.a706.backend.user.sanction.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.user.sanction.SanctionRefType;

/**
 * 영구 정지 부과 요청.
 *
 * <p>기간 정지({@link SuspendUserRequest})와 달리 {@code days}가 없다 — 그게 영구 정지의 정의다.
 * 필드를 두고 null을 "영구"로 해석하는 방식은 쓰지 않았다: 같은 엔드포인트에 기간을 넣었다 뺐다 하는
 * 요청이 섞이면 실수로 영구 제재가 나가고, 그건 되돌리기 가장 어려운 실수다.</p>
 *
 * @param reason     제재 사유. 영구 제재는 특히 근거가 남아야 하므로 필수다.
 * @param reportId   근거가 된 신고 id. 직권 제재면 생략한다.
 * @param reportType 그 id가 어느 신고 테이블의 행인지. reportId와 짝이다.
 */
public record BanUserRequest(
        @NotBlank @Size(max = 200) String reason,
        Long reportId,
        SanctionRefType reportType
) {

    /** 기간 정지와 같은 규칙 — (id, 유형)이 짝이 아니면 되짚을 수 없는 참조가 이력에 남는다. */
    @AssertTrue(message = "reportId와 reportType은 함께 지정해야 합니다")
    public boolean isReportRefPaired() {
        return (reportId == null) == (reportType == null);
    }
}
