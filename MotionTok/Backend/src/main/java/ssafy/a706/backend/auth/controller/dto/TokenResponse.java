package ssafy.a706.backend.auth.controller.dto;

import ssafy.a706.backend.user.controller.dto.UserProfileResponse;

/** API 명세서 TokenResponse 스키마. */
public record TokenResponse(
        String tokenType,
        String accessToken,
        String refreshToken,
        long expiresIn,
        UserProfileResponse user
) {
    public static TokenResponse of(String accessToken, String refreshToken, long expiresIn, UserProfileResponse user) {
        return new TokenResponse("Bearer", accessToken, refreshToken, expiresIn, user);
    }
}
