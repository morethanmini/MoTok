package ssafy.a706.backend.shop.model;

/** ERD v0.2 POINT_HISTORY.type */
public enum PointHistoryType {
    GAME_REWARD, SHOP_PURCHASE, AI_GENERATE, GUEST_MIGRATE,
    /** AI 아이템 생성 실패(FAILED) 시 AI_GENERATE 차감분 환불. 항상 양수. */
    AI_GENERATE_REFUND
}
