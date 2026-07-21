package ssafy.a706.backend.auth.oauth.client;

import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.reactive.function.client.WebClient;
import ssafy.a706.backend.auth.oauth.OauthProperties;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.auth.oauth.OauthUserInfo;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

/**
 * Kakao OAuth — 인가 코드 → 토큰 → /v2/user/me.
 * 사용자 정보: id(고유 id)·kakao_account.email(+is_email_verified·is_email_valid)·profile.nickname.
 * email·nickname은 동의항목 설정과 사용자 동의에 따라 없을 수 있다.
 */
@Component
public class KakaoOauthClient extends AbstractOauthClient {

    private static final String TOKEN_URI = "https://kauth.kakao.com/oauth/token";
    private static final String USERINFO_URI = "https://kapi.kakao.com/v2/user/me";

    private final OauthProperties properties;

    public KakaoOauthClient(WebClient oauthWebClient, ObjectMapper objectMapper, OauthProperties properties) {
        super(oauthWebClient, objectMapper);
        this.properties = properties;
    }

    @Override
    public OauthProvider provider() {
        return OauthProvider.KAKAO;
    }

    @Override
    public OauthUserInfo fetch(String authorizationCode, String redirectUri) {
        OauthProperties.Registration reg = properties.kakao();
        if (reg == null || reg.clientId() == null || reg.clientId().isBlank()) {
            throw fail("kakao client-id 미설정");
        }

        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", reg.clientId());
        if (reg.clientSecret() != null && !reg.clientSecret().isBlank()) {
            form.add("client_secret", reg.clientSecret());
        }
        form.add("code", authorizationCode);
        if (redirectUri != null && !redirectUri.isBlank()) {
            form.add("redirect_uri", redirectUri);
        }

        Map<String, Object> token = postForm(TOKEN_URI, form);
        String accessToken = str(token.get("access_token"));
        if (accessToken == null) {
            throw fail("access_token 없음");
        }

        Map<String, Object> me = getWithBearer(USERINFO_URI, accessToken);
        String uid = str(me.get("id"));
        if (uid == null) {
            throw fail("id 없음");
        }

        Map<String, Object> account = mapOf(me.get("kakao_account"));
        String email = account == null ? null : str(account.get("email"));
        boolean emailVerified = account != null
                && truthy(account.get("is_email_verified"))
                && truthy(account.get("is_email_valid"));
        Map<String, Object> profile = account == null ? null : mapOf(account.get("profile"));
        String nickname = profile == null ? null : str(profile.get("nickname"));

        return new OauthUserInfo(OauthProvider.KAKAO, uid, email, emailVerified, nickname);
    }
}
