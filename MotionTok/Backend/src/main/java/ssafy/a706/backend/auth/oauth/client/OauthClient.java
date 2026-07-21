package ssafy.a706.backend.auth.oauth.client;

import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.auth.oauth.OauthUserInfo;

/** provider별 OAuth 클라이언트. 인가 코드를 토큰으로 교환하고 사용자 정보를 정규화한다. */
public interface OauthClient {

    OauthProvider provider();

    /**
     * 인가 코드 → provider 토큰 → 사용자 정보(정규화).
     * provider 호출/응답 실패 시 SOCIAL_LOGIN_FAILED(401)를 던진다.
     */
    OauthUserInfo fetch(String authorizationCode, String redirectUri);
}
