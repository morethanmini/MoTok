package ssafy.a706.backend.shop.controller.dto;

import ssafy.a706.backend.shop.model.PointHistoryType;

import java.time.LocalDateTime;
import java.util.List;

/**
 * GET /v1/admin/points — 관리자 포인트 내역 페이지.
 *
 * <p>신고·제재 목록({@code ChatReportListResponse} 등)과 같은 평평한 페이지 형태다. 회원 본인용
 * {@code PointHistoryPageResponse}가 {@code page} 객체로 감싸는 것과 다른데, 이건 명세 §2가
 * 정한 규정이 계열별로 갈리기 때문이다 — 관리자 계열은 평평한 쪽이다.</p>
 *
 * @param summary 대상 회원의 전체 적립·사용 합계와 현재 잔액. <b>회원을 지정하지 않으면 null</b> —
 *                여러 사람의 포인트를 합친 숫자는 아무 질문에도 답하지 않는다.
 */
public record AdminPointHistoryListResponse(
        List<Entry> histories,
        int page,
        int size,
        long totalElements,
        int totalPages,
        Summary summary
) {

    /**
     * @param nickname 조회 시점의 닉네임. 제재 이력과 달리 스냅샷이 아니라 현재 값이다 —
     *                 포인트 내역은 회계 기록이라 대상 식별은 userId가 하고, 닉네임은 읽는 사람을
     *                 위한 표시일 뿐이다. 탈퇴 등으로 사용자 행이 없으면 null.
     */
    public record Entry(
            Long id,
            Long userId,
            String nickname,
            /** +적립 / -사용. 부호를 그대로 내려 화면이 방향을 다시 계산하지 않게 한다. */
            int amount,
            PointHistoryType type,
            Long refId,
            int balanceAfter,
            LocalDateTime createdAt
    ) {}

    /**
     * @param earned         총 적립(양수 합)
     * @param spent          총 사용(음수 합을 양수로 뒤집은 값)
     * @param currentBalance users.point_balance. 탈퇴 등으로 사용자 행이 없으면 null.
     */
    public record Summary(long earned, long spent, Integer currentBalance) {}
}
