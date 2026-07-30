package ssafy.a706.backend.user.sanction.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import ssafy.a706.backend.user.sanction.SanctionRefType;

/**
 * 계정 정지 부과 요청.
 *
 * <p>상한을 365일로 두는 이유 — 그보다 긴 제재는 사실상 영구 정지이고, 그건 되돌릴 주체가 필요 없는
 * users.status=BANNED로 표현해야 할 다른 결정이다. TTL로 5년을 거는 건 의도를 숨긴 영구 정지가 된다.</p>
 *
 * @param days       정지 일수(1~365)
 * @param reason     제재 사유. 이력에 그대로 남으므로 필수다 — 사유 없는 제재는 나중에 검증할 수 없다.
 * @param reportId   근거가 된 신고 id. 직권 제재면 생략한다.
 * @param reportType 그 id가 어느 신고 테이블의 행인지. reportId와 짝으로만 의미가 있다.
 */
public record SuspendUserRequest(
        @Min(1) @Max(365) int days,
        @NotBlank @Size(max = 200) String reason,
        Long reportId,
        SanctionRefType reportType
) {

    /**
     * 신고 참조는 (id, 유형) 쌍으로만 성립한다.
     *
     * <p>id만 오면 어느 테이블의 행인지 알 수 없어 되짚을 수 없는 값이 이력에 남고, 유형만 오면
     * 가리키는 대상이 없다. 한쪽을 조용히 버리면 화면에는 "근거 신고 있음"으로 보이는데 이력에는
     * 없는 상태가 되므로 400으로 끊는다.</p>
     */
    @AssertTrue(message = "reportId와 reportType은 함께 지정해야 합니다")
    public boolean isReportRefPaired() {
        return (reportId == null) == (reportType == null);
    }
}
