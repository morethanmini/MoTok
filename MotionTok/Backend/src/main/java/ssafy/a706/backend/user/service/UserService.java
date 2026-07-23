package ssafy.a706.backend.user.service;

import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.auth.oauth.OauthUserInfo;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.oauth.entity.OauthAccount;
import ssafy.a706.backend.auth.oauth.repository.OauthAccountRepository;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.controller.dto.PublicUserProfileResponse;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;
import ssafy.a706.backend.user.controller.dto.WithdrawRequest;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.withdrawal.RejoinPolicy;
import ssafy.a706.backend.user.withdrawal.WithdrawnIdentifierType;

import java.util.List;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final RefreshTokenStore refreshTokenStore;
    private final OauthAccountRepository oauthAccountRepository;
    private final OauthClientResolver oauthClientResolver;
    private final RejoinPolicy rejoinPolicy;

    public UserProfileResponse getProfile(Long userId) {
        return UserProfileResponse.from(findActiveById(userId));
    }

    /**
     * GET /users/{userId} — 다른 사용자의 공개 프로필(-96 랭킹에서 프로필 조회).
     * 탈퇴·정지 계정은 노출하지 않고 404로 응답한다(탈퇴 계정 랭킹 노출 제외 정책과 같은 선).
     */
    public PublicUserProfileResponse getPublicProfile(Long userId) {
        User user = userRepository.findById(userId)
                .filter(User::isActive)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
        return PublicUserProfileResponse.from(user);
    }

    /** PATCH /users/me — 닉네임 변경(중복 검사). 동시 변경 경합은 UNIQUE 위반을 409로 변환한다. */
    @Transactional
    public UserProfileResponse updateNickname(Long userId, String rawNickname) {
        String nickname = rawNickname.trim();
        User user = findActiveById(userId);
        if (nickname.equals(user.getNickname())) {
            return UserProfileResponse.from(user); // 지금 닉네임 그대로 — 변경 없음
        }
        // 자신을 제외하고 검사 — CI 콜레이션에서 대소문자만 바꾸는 변경이 본인 행에 걸려 409가 나지 않게 한다.
        if (userRepository.existsByNicknameAndIdNot(nickname, userId)) {
            throw new BusinessException(ErrorCode.NICKNAME_ALREADY_USED);
        }
        user.changeNickname(nickname);
        try {
            return UserProfileResponse.from(userRepository.saveAndFlush(user));
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(ErrorCode.NICKNAME_ALREADY_USED);
        }
    }

    /** PATCH /users/me/password — 현재 비밀번호 확인 후 변경. 변경 시 Refresh 토큰을 무효화해 다른 세션을 로그아웃시킨다. */
    @Transactional
    public void changePassword(Long userId, String currentPassword, String newPassword) {
        User user = findActiveById(userId);
        // 소셜 전용 계정(passwordHash null)은 현재 비밀번호가 존재하지 않으므로 항상 거절된다.
        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new BusinessException(ErrorCode.INVALID_CREDENTIALS);
        }
        user.changePassword(passwordEncoder.encode(newPassword));
        refreshTokenStore.delete(userId);
    }

    /**
     * DELETE /users/me — 본인 확인 후 soft delete(닉네임·이메일 치환 포함), 그리고 Refresh 토큰 무효화(-111).
     *
     * 순서가 중요하다.
     *  ① 본인 확인 — 자체 가입은 비밀번호, 소셜 전용 계정은 소셜 재인증.
     *  ② 재가입 제한 기록 — tombstone으로 덮이기 전의 이메일·소셜 UID를 해시로 남긴다.
     *  ③ soft delete + flush로 DB를 확정한 뒤에야 연동 해제·Redis 정리 같은 부수효과를 실행한다(반쪽 탈퇴 방지).
     *
     * 이미 DELETED인 계정의 재호출은 ①에서 걸러진다(비밀번호 해시도 tombstone도 남아 있지 않음).
     */
    @Transactional
    public void withdraw(Long userId, WithdrawRequest req) {
        User user = findActiveById(userId);
        verifyOwnership(user, req);

        List<OauthAccount> linked = oauthAccountRepository.findAllByUser(user);
        if (user.getEmail() != null) {
            rejoinPolicy.record(user.getEmail(), WithdrawnIdentifierType.EMAIL);
        }
        for (OauthAccount account : linked) {
            rejoinPolicy.record(
                    RejoinPolicy.socialIdentifier(account.getProvider().name(), account.getProviderUid()),
                    WithdrawnIdentifierType.SOCIAL);
        }

        user.softDelete();
        userRepository.saveAndFlush(user);
        oauthAccountRepository.deleteByUser(user); // 연동 해제 — 쿨다운이 지나면 같은 소셜 계정으로 신규 가입 가능
        refreshTokenStore.delete(userId);
    }

    /**
     * 탈퇴 본인 확인.
     * 소셜 전용 계정에 비밀번호를 요구하면 탈퇴할 방법이 아예 없어지므로, 대신 같은 소셜 계정으로
     * 다시 인가받아 온 코드가 이 계정에 연동된 UID와 일치하는지 검증한다(비밀번호와 동등한 강도의 본인 확인).
     */
    private void verifyOwnership(User user, WithdrawRequest req) {
        if (req != null && req.hasPassword() && !user.isSocialOnly()) {
            if (!passwordEncoder.matches(req.password(), user.getPasswordHash())) {
                throw new BusinessException(ErrorCode.INVALID_CREDENTIALS);
            }
            return;
        }
        if (req != null && req.hasSocialProof()) {
            verifySocialOwnership(user, req);
            return;
        }
        throw new BusinessException(user.isSocialOnly()
                ? ErrorCode.WITHDRAW_SOCIAL_REAUTH_REQUIRED
                : ErrorCode.WITHDRAW_REAUTH_REQUIRED);
    }

    private void verifySocialOwnership(User user, WithdrawRequest req) {
        OauthProvider provider = OauthProvider.from(req.provider());
        OauthUserInfo info = oauthClientResolver.resolve(provider)
                .fetch(req.authorizationCode(), req.redirectUri());

        boolean linkedToMe = oauthAccountRepository
                .findByProviderAndProviderUid(provider, info.providerUid())
                .filter(account -> account.getUser().getId().equals(user.getId()))
                .isPresent();
        if (!linkedToMe) {
            throw new BusinessException(ErrorCode.INVALID_CREDENTIALS);
        }
    }

    public User findById(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
    }

    /**
     * 탈퇴·정지 계정의 잔존 액세스 토큰(최대 30분) 차단 — 상태가 ACTIVE가 아니면 401.
     * (JWT는 무상태라 필터에서 걸러지지 않으므로 리소스 경로에서 막는다. 명세 응답 401 준수)
     */
    private User findActiveById(Long userId) {
        User user = findById(userId);
        if (!user.isActive()) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED);
        }
        return user;
    }
}
