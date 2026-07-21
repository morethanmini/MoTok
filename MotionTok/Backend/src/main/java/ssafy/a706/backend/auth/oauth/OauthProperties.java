package ssafy.a706.backend.auth.oauth;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * application.yaml의 app.oauth.* — provider별 클라이언트 자격증명.
 * token·userinfo 엔드포인트는 provider별 고정 상수라 클라이언트 코드에 두고, 여기서는 비밀값만 외부화한다.
 * kakao의 client-secret은 선택(콘솔에서 미사용 시 빈 값)이다.
 */
@ConfigurationProperties(prefix = "app.oauth")
public record OauthProperties(Registration google, Registration kakao) {

    public record Registration(String clientId, String clientSecret) {
    }
}
