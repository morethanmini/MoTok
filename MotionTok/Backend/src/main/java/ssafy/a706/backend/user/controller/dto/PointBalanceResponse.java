package ssafy.a706.backend.user.controller.dto;

/** GET /users/me/points — 현재 포인트 잔액. 상점이 구매 가능 여부를 서버 값으로 판단하는 근거. */
public record PointBalanceResponse(int pointBalance) {}
