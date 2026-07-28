package ssafy.a706.backend.decor.controller.dto;

import jakarta.validation.constraints.NotNull;

/** PUT /users/me/decoration 요청 본문. */
public record SaveDecorationRequest(@NotNull DecorConfigPayload config) {}
