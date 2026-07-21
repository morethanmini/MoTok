package ssafy.a706.backend.auth.oauth.client;

import org.springframework.stereotype.Component;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/** provider → 담당 OauthClient. 등록되지 않은 provider는 UNSUPPORTED_OAUTH_PROVIDER(400). */
@Component
public class OauthClientResolver {

    private final Map<OauthProvider, OauthClient> clients = new EnumMap<>(OauthProvider.class);

    public OauthClientResolver(List<OauthClient> clientList) {
        for (OauthClient client : clientList) {
            clients.put(client.provider(), client);
        }
    }

    public OauthClient resolve(OauthProvider provider) {
        OauthClient client = clients.get(provider);
        if (client == null) {
            throw new BusinessException(ErrorCode.UNSUPPORTED_OAUTH_PROVIDER);
        }
        return client;
    }
}
