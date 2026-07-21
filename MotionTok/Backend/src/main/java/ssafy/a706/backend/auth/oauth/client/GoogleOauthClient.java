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
 * Google OAuth 2.0 — 인가 코드 → 토큰 → OIDC userinfo.
 * userinfo: sub(고유 id)·email·email_verified·name.
 */
@Component
public class GoogleOauthClient extends AbstractOauthClient {

    private static final String TOKEN_URI = "https://oauth2.googleapis.com/token";
    private static final String USERINFO_URI = "https://openidconnect.googleapis.com/v1/userinfo";

    private final OauthProperties properties;

    public GoogleOauthClient(WebClient oauthWebClient, ObjectMapper objectMapper, OauthProperties properties) {
        super(oauthWebClient, objectMapper);
        this.properties = properties;
    }

    @Override
    public OauthProvider provider() {
        return OauthProvider.GOOGLE;
    }

    @Override
    public OauthUserInfo fetch(String authorizationCode, String redirectUri) {
        OauthProperties.Registration reg = properties.google();
        if (reg == null || reg.clientId() == null || reg.clientId().isBlank()) {
            throw fail("google client-id 미설정");
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
        String sub = str(me.get("sub"));
        if (sub == null) {
            throw fail("sub 없음");
        }

        return new OauthUserInfo(
                OauthProvider.GOOGLE,
                sub,
                str(me.get("email")),
                truthy(me.get("email_verified")),
                str(me.get("name")));
    }
}
