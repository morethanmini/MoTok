package ssafy.a706.backend.auth.oauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.auth.oauth.entity.OauthAccount;
import ssafy.a706.backend.user.entity.User;

import java.util.List;
import java.util.Optional;

public interface OauthAccountRepository extends JpaRepository<OauthAccount, Long> {

    Optional<OauthAccount> findByProviderAndProviderUid(OauthProvider provider, String providerUid);

    /** 탈퇴 시 재가입 제한을 걸어 둘 소셜 식별자를 모으기 위해 — 연동 해제 전에 조회한다(-111). */
    List<OauthAccount> findAllByUser(User user);

    /** 탈퇴 시 소셜 연동 해제 — 재가입 쿨다운이 지나면 같은 소셜 계정으로 신규 가입이 가능해진다. */
    void deleteByUser(User user);
}
