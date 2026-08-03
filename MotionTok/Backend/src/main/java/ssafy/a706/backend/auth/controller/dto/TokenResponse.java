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
        boolean nicknameSetupRequired,
        /**
         * 소셜 로그인이 같은 '인증된' 이메일의 기존 계정에 <b>이번에 처음</b> 연동됐으면 true.
         * 클라이언트는 이때 한 번만 "기존 계정으로 로그인했어요"를 안내한다(OauthLinkService 정책 참고).
         * 그 외 응답(일반 로그인·갱신·재로그인)에서는 null — 선택 필드라 래퍼 타입이다.
         */
        Boolean linkedExistingAccount
) {
    public static TokenResponse of(String accessToken, long expiresIn, UserProfileResponse user) {
        return new TokenResponse("Bearer", accessToken, expiresIn, user,
                user != null && user.nicknamePending(), null);
    }

    /** 소셜 최초 연동 표시가 붙은 사본 — 소셜 로그인 경로에서만 쓴다. */
    public TokenResponse withLinkedExistingAccount() {
        return new TokenResponse(tokenType, accessToken, expiresIn, user, nicknameSetupRequired, Boolean.TRUE);
    }
}
