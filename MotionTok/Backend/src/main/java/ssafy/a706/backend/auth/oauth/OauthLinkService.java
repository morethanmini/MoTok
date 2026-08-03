package ssafy.a706.backend.auth.oauth;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.oauth.entity.OauthAccount;
import ssafy.a706.backend.auth.oauth.repository.OauthAccountRepository;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.withdrawal.RejoinPolicy;
import ssafy.a706.backend.user.withdrawal.WithdrawnIdentifierType;

import java.util.Optional;
import java.util.UUID;

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
    private final RejoinPolicy rejoinPolicy;

    /** 이미 연동된 계정의 userId. 복구 조회도 이 메서드(= 새 트랜잭션)를 쓴다. */
    @Transactional(readOnly = true)
    public Optional<Long> findLinkedUserId(OauthProvider provider, String providerUid) {
        return oauthAccountRepository.findByProviderAndProviderUid(provider, providerUid)
                .map(oa -> oa.getUser().getId());
    }

    /**
     * createAndLink 결과 — 어느 계정에 연동됐고, 그 계정이 <b>기존 회원</b>이었는지.
     * linkedToExisting은 응답의 linkedExistingAccount로 나가 "기존 계정으로 로그인했어요" 안내(1회)의 근거가 된다.
     */
    public record LinkResult(Long userId, boolean linkedToExisting) {}

    /**
     * 최초 소셜 로그인 — 계정 결정(기존 인증-이메일 연동 or 신규 생성) + OAUTH_ACCOUNT 연동을 한 트랜잭션으로.
     * 경합 시 saveAndFlush가 DataIntegrityViolationException을 던지고 트랜잭션 전체가 롤백된다(USER 생성분 포함).
     */
    @Transactional
    public LinkResult createAndLink(OauthProvider provider, OauthUserInfo info) {
        // 여기까지 왔다는 건 이 소셜 계정에 연동된 회원이 없다는 뜻 — 탈퇴 직후 재가입인지 먼저 본다(-111).
        rejoinPolicy.ensureRejoinable(
                RejoinPolicy.socialIdentifier(provider.name(), info.providerUid()),
                WithdrawnIdentifierType.SOCIAL);

        LinkTarget target = resolveLinkTarget(info);
        oauthAccountRepository.saveAndFlush(OauthAccount.of(target.user(), provider, info.providerUid()));
        return new LinkResult(target.user().getId(), target.existing());
    }

    /** 연동 대상 — 엔티티는 OAUTH_ACCOUNT 저장에, existing은 LinkResult에 쓴다. */
    private record LinkTarget(User user, boolean existing) {}

    /**
     * 연동 대상 사용자 결정.
     * provider가 '인증된' 이메일을 준 경우에만 그 이메일의 기존 계정과 연동한다(미인증 이메일 연동은 계정 탈취 위험).
     * 그 외에는 이메일 없는 소셜 전용 계정을 새로 만든다.
     */
    private LinkTarget resolveLinkTarget(OauthUserInfo info) {
        if (info.email() != null && info.emailVerified()) {
            String email = info.email().trim().toLowerCase();
            return userRepository.findByEmail(email)
                    .map(existing -> new LinkTarget(existing, true))
                    .orElseGet(() -> new LinkTarget(createSocialUser(email, info), false));
        }
        return new LinkTarget(createSocialUser(null, info), false);
    }

    private User createSocialUser(String email, OauthUserInfo info) {
        // 소셜로 우회해 이메일 재가입 쿨다운을 건너뛰지 못하게 한다(-111).
        if (email != null) {
            rejoinPolicy.ensureRejoinable(email, WithdrawnIdentifierType.EMAIL);
        }
        User user = User.builder()
                .email(email)          // 미인증/미제공 시 null — 소셜 전용 계정
                .passwordHash(null)    // 소셜 전용이라 로컬 로그인 불가
                .nickname(placeholderNickname())
                .nicknamePending(true) // 닉네임은 앱 안에서 사용자가 직접 정한다(-22)
                .build();
        return userRepository.saveAndFlush(user);
    }

    /**
     * 닉네임 설정 전까지 UNIQUE·NOT NULL 제약을 채워 둘 임시값.
     * provider 닉네임을 그대로 쓰지 않는 이유 — 카카오·구글 닉네임은 서비스 밖에서 정해진 값이라
     * 운영 정책(2~16자·중복 검사)을 통과했다고 볼 수 없고, 사용자가 고르지도 않은 이름이 노출된다.
     * 길이를 28자로 잡아 닉네임 상한(16자)을 넘김으로써 사용자가 같은 값을 선점할 수 없게 한다(탈퇴 tombstone과 같은 방식).
     */
    private String placeholderNickname() {
        return "pending_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
    }
}
