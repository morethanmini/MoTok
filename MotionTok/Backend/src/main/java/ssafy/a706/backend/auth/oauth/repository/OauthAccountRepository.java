package ssafy.a706.backend.auth.oauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.auth.oauth.entity.OauthAccount;

import java.util.Optional;

public interface OauthAccountRepository extends JpaRepository<OauthAccount, Long> {

    Optional<OauthAccount> findByProviderAndProviderUid(OauthProvider provider, String providerUid);
}
