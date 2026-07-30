package ssafy.a706.backend.shop.repository.dto;

/**
 * 한 회원의 포인트 총 적립·총 사용 합계.
 *
 * <p>둘을 한 쿼리로 묶는 이유 — 따로 두면 그 사이에 새 내역이 들어와 "적립 - 사용 ≠ 잔액"인
 * 숫자 세 개가 화면에 함께 뜬다. 관리자는 그걸 데이터 오류로 읽는다.</p>
 *
 * <p>사용액({@code spent})은 <b>양수로 뒤집어</b> 담는다. point_history.amount는 사용이 음수지만
 * 화면은 "쓴 금액 1,200P"로 읽히는 값을 원하고, 부호를 화면마다 뒤집으면 한 곳에서 빠뜨린다.</p>
 */
public record PointFlowSum(long earned, long spent) {

    public static final PointFlowSum ZERO = new PointFlowSum(0L, 0L);
}
