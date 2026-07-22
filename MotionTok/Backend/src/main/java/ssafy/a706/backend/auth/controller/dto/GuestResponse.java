package ssafy.a706.backend.auth.controller.dto;

/** API 명세서 GuestResponse 스키마 — 게스트 시작(-109). */
public record GuestResponse(
        String accessToken,
        String guestNickname,
        String roomId
) {
}
