package ssafy.a706.backend.auth.oauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.auth.oauth.entity.OauthAccount;
import ssafy.a706.backend.user.entity.User;

import java.util.Optional;

public interface OauthAccountRepository extends JpaRepository<OauthAccount, Long> {

    Optional<OauthAccount> findByProviderAndProviderUid(OauthProvider provider, String providerUid);

    /** 탈퇴 시 소셜 연동 해제 — 이후 같은 소셜 계정으로 신규 가입이 가능해진다. */
    void deleteByUser(User user);
}
