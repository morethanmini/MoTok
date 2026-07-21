package ssafy.a706.backend.auth.oauth;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.oauth.entity.OauthAccount;
import ssafy.a706.backend.auth.oauth.repository.OauthAccountRepository;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 소셜 계정 조회·생성·연동 (OAUTH_ACCOUNT).
 * 조회와 생성을 별도 트랜잭션 메서드로 분리한 이유:
 *   최초 로그인 경합으로 복합 UNIQUE(provider, provider_uid)에 걸리면 createAndLink의 트랜잭션은 통째로 롤백된다(고아 USER 없음).
 *   그 뒤 복구 조회는 롤백된 트랜잭션이 아니라 새 트랜잭션(새 스냅샷)에서 돌아야 먼저 커밋된 연동을 볼 수 있다.
 * 그래서 AuthService(호출자)는 이 두 메서드를 프록시 경유로 각각 다른 물리 트랜잭션에서 실행한다.
 */
@Service
@RequiredArgsConstructor
public class OauthLinkService {

    private final UserRepository userRepository;
    private final OauthAccountRepository oauthAccountRepository;

    /** 이미 연동된 계정의 userId. 복구 조회도 이 메서드(= 새 트랜잭션)를 쓴다. */
    @Transactional(readOnly = true)
    public Optional<Long> findLinkedUserId(OauthProvider provider, String providerUid) {
        return oauthAccountRepository.findByProviderAndProviderUid(provider, providerUid)
                .map(oa -> oa.getUser().getId());
    }

    /**
     * 최초 소셜 로그인 — 계정 결정(기존 인증-이메일 연동 or 신규 생성) + OAUTH_ACCOUNT 연동을 한 트랜잭션으로.
     * 경합 시 saveAndFlush가 DataIntegrityViolationException을 던지고 트랜잭션 전체가 롤백된다(USER 생성분 포함).
     */
    @Transactional
    public Long createAndLink(OauthProvider provider, OauthUserInfo info) {
        User user = resolveLinkTarget(info);
        oauthAccountRepository.saveAndFlush(OauthAccount.of(user, provider, info.providerUid()));
        return user.getId();
    }

    /**
     * 연동 대상 사용자 결정.
     * provider가 '인증된' 이메일을 준 경우에만 그 이메일의 기존 계정과 연동한다(미인증 이메일 연동은 계정 탈취 위험).
     * 그 외에는 이메일 없는 소셜 전용 계정을 새로 만든다.
     */
    private User resolveLinkTarget(OauthUserInfo info) {
        if (info.email() != null && info.emailVerified()) {
            String email = info.email().trim().toLowerCase();
            return userRepository.findByEmail(email)
                    .orElseGet(() -> createSocialUser(email, info));
        }
        return createSocialUser(null, info);
    }

    private User createSocialUser(String email, OauthUserInfo info) {
        User user = User.builder()
                .email(email)          // 미인증/미제공 시 null — 소셜 전용 계정
                .passwordHash(null)    // 소셜 전용이라 로컬 로그인 불가
                .nickname(generateUniqueNickname(info))
                .build();
        return userRepository.saveAndFlush(user);
    }

    /** 닉네임은 UNIQUE·NOT NULL이라, provider 닉네임(없으면 기본값)을 기준으로 충돌 없는 값을 만든다(최대 16자). */
    private String generateUniqueNickname(OauthUserInfo info) {
        String base = (info.nickname() == null || info.nickname().isBlank())
                ? (info.provider() == OauthProvider.KAKAO ? "카카오" : "구글") + "유저"
                : info.nickname().trim();
        if (base.length() > 12) {
            base = base.substring(0, 12);
        }
        if (base.length() < 2) {
            base = base + "유저";
        }
        for (int i = 0; i < 12; i++) {
            String candidate = (i == 0) ? base : base + ThreadLocalRandom.current().nextInt(1000, 10000);
            if (candidate.length() > 16) {
                candidate = candidate.substring(0, 16);
            }
            if (!userRepository.existsByNickname(candidate)) {
                return candidate;
            }
        }
        return "user" + ThreadLocalRandom.current().nextInt(100_000_000);
    }
}
