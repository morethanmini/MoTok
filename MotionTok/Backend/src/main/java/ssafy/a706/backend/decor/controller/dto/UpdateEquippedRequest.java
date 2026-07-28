package ssafy.a706.backend.decor.controller.dto;

import jakarta.validation.constraints.NotNull;

/** PATCH /users/me/inventory/{itemId} 요청 본문 — 장착/해제. */
public record UpdateEquippedRequest(@NotNull Boolean equipped) {}
