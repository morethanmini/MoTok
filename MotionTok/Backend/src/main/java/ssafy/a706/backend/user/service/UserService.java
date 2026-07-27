package ssafy.a706.backend.user.service;

import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.auth.oauth.OauthUserInfo;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.oauth.entity.OauthAccount;
import ssafy.a706.backend.auth.oauth.repository.OauthAccountRepository;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.storage.StorageService;
import ssafy.a706.backend.storage.UploadPurpose;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.controller.dto.PublicUserProfileResponse;
import ssafy.a706.backend.user.controller.dto.UpdateAvatarRequest;
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
    private final StorageService storageService;

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

    /**
     * PATCH /users/me/avatar — 업로드가 끝난 오브젝트를 프로필 사진으로 확정한다.
     *
     * <p>업로드 자체는 브라우저가 presigned URL로 S3에 직접 하므로 <b>서버는 결과만 받는다.</b>
     * 그래서 여기서 두 가지를 반드시 확인해야 한다 — 둘 중 하나라도 빠지면 presigned 방식의
     * 마지막 방어선이 사라진다:</p>
     * <ol>
     *   <li><b>소유권</b> — key가 내 prefix({@code public/avatars/{userId}/})인가.
     *       안 하면 남의 key나 아무 문자열이나 자기 프로필에 박을 수 있다.</li>
     *   <li><b>존재</b> — 실제로 올라간 객체인가. presigned URL만 받고 PUT을 하지 않아도
     *       클라이언트는 key를 알고 있어서, 확인하지 않으면 깨진 URL이 DB에 남는다.</li>
     * </ol>
     * (둘 다 {@link StorageService#confirmOwned}가 처리한다.)
     *
     * <p>key가 null이면 기본 아바타로 되돌린다 — 변경과 삭제를 한 엔드포인트로 처리한다.</p>
     */
    @Transactional
    public UserProfileResponse updateAvatar(Long userId, UpdateAvatarRequest req) {
        User user = findActiveById(userId);
        String previousUrl = user.getAvatarUrl();

        String key = req.key() == null || req.key().isBlank() ? null : req.key().trim();
        user.changeAvatarUrl(key == null ? null : storageService.confirmOwned(UploadPurpose.AVATAR, userId, key));

        // 이전 사진은 커밋된 뒤에 지운다. 트랜잭션 안에서 지우면 이후 롤백 시 아직 참조 중인
        // 객체를 이미 삭제한 상태가 되어 프로필 사진이 깨진다(삭제는 되돌릴 수 없다).
        deleteAfterCommit(previousUrl);

        return UserProfileResponse.from(user);
    }

    /** 이전 아바타 객체 정리. 실패해도 본 흐름을 막지 않는다 — 고아 객체는 나중에 정리할 수 있다. */
    private void deleteAfterCommit(String previousUrl) {
        String previousKey = storageService.keyFromPublicUrl(previousUrl);
        if (previousKey == null) {
            return;
        }
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            storageService.deleteQuietly(previousKey);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                storageService.deleteQuietly(previousKey);
            }
        });
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
