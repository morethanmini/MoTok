package ssafy.a706.backend.shop.controller.dto;

/** API 명세서 PurchaseResponse 스키마. */
public record PurchaseResponse(Long itemId, int balanceAfter) {
}
