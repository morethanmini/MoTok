package ssafy.a706.backend.shop.model;

/**
 * 포인트 흐름의 방향 — 관리자 내역 조회 필터(-106 후속).
 *
 * <p>테이블에 없는 값이다. point_history는 {@code amount}의 부호로만 방향을 표현하고
 * ({@code +}적립 / {@code -}사용) 그게 단일 원천이다. 이 enum은 <b>질의 언어</b>다 —
 * 관리자가 "받아 간 내역"과 "쓴 내역"을 말로 고를 수 있게 하기 위한 것.</p>
 *
 * <p>{@link PointHistoryType}으로 대신할 수 없다 — AI_GENERATE는 차감이고
 * AI_GENERATE_REFUND는 환급이라, 유형만 봐서는 방향을 알 수 없다.</p>
 */
public enum PointDirection {
    /** 받아 간 내역 (amount > 0) */
    EARN,
    /** 쓴 내역 (amount < 0) */
    SPEND
}
