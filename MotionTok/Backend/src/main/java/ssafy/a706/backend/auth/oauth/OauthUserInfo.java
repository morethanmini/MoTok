package ssafy.a706.backend.auth.oauth;

/**
 * provider별 응답을 정규화한 소셜 사용자 식별 정보.
 * providerUid는 provider가 부여한 고유 식별자(Google sub, Kakao id)로 항상 존재한다.
 * email·nickname은 사용자 동의/제공 여부에 따라 null일 수 있다.
 */
public record OauthUserInfo(
        OauthProvider provider,
        String providerUid,
        String email,
        boolean emailVerified,
        String nickname
) {
}
