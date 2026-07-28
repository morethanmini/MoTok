package ssafy.a706.backend.decor.controller.dto;

import java.time.LocalDateTime;

/** GET·PUT /users/me/decoration 응답. 설정이 한 번도 저장된 적 없으면 updatedAt은 null이다. */
public record DecorationResponse(DecorConfigPayload config, LocalDateTime updatedAt) {}
