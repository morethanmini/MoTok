package ssafy.a706.backend.auth.controller.dto;

import ssafy.a706.backend.user.controller.dto.UserProfileResponse;

/**
 * API 명세서 TokenResponse 스키마.
 * Refresh 토큰은 이 본문에 담지 않는다 — HttpOnly 쿠키로만 오간다({@code RefreshCookies}).
 */
public record TokenResponse(
        String tokenType,
        String accessToken,
        long expiresIn,
        UserProfileResponse user,
        /**
         * true면 닉네임 설정 화면으로 보내야 한다(-22 소셜 최초 로그인).
         * user.nicknamePending과 같은 값이지만, 클라이언트가 분기 하나만 보면 되도록 최상위에도 싣는다.
         */
        boolean nicknameSetupRequired
) {
    public static TokenResponse of(String accessToken, long expiresIn, UserProfileResponse user) {
        return new TokenResponse("Bearer", accessToken, expiresIn, user,
                user != null && user.nicknamePending());
    }
}
