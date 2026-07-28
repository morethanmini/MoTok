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
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import ssafy.a706.backend.shop.repository.PointHistoryRepository;
import ssafy.a706.backend.user.controller.dto.PointBalanceResponse;
import ssafy.a706.backend.user.controller.dto.PointHistoryPageResponse;
import ssafy.a706.backend.user.controller.dto.PublicUserProfileResponse;
import ssafy.a706.backend.user.controller.dto.UpdateAvatarRequest;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;
import ssafy.a706.backend.user.controller.dto.WithdrawRequest;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.withdrawal.RejoinPolicy;
import ssafy.a706.backend.user.withdrawal.WithdrawnIdentifierType;

import java.util.List;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

    /**
     * 기본 프로필 아이콘 파일명 규칙 — {@code 4_cat}, {@code 10_bunny} 처럼 번호와 영문 이름뿐이다.
     *
     * <p>목록 전체를 서버에 복사해 두지 않고 형식만 검사한다. 아이콘은 프론트엔드 정적 자산이라
     * 늘거나 이름이 바뀌는 쪽은 항상 프론트인데, 목록을 양쪽에 두면 아이콘을 추가할 때마다 배포가
     * 묶인다. 없는 파일을 고르더라도 화면은 기본 이모지로 떨어질 뿐이라(UserAvatar) 피해가 없다.</p>
     *
     * <p>대신 형식은 좁게 잡는다 — 슬래시·콜론·점이 못 들어가므로 경로 탈출이나 외부 URL 삽입이
     * 불가능하다. 이 값은 <b>친구 목록을 통해 다른 사용자 화면에 img src로 렌더링</b>되므로 여기가 방어선이다.</p>
     */
    private static final Pattern AVATAR_PRESET = Pattern.compile("^\\d{1,2}_[a-z]{2,16}$");

    /** 기본 프로필 아이콘이 놓인 정적 경로. 업로드 사진과 달리 S3가 아니라 우리 정적 자산이다. */
    private static final String AVATAR_PRESET_PATH = "/assets/icons/profile/";

    private final UserRepository userRepository;
    private final PointHistoryRepository pointHistoryRepository;
    private final PasswordEncoder passwordEncoder;
    private final RefreshTokenStore refreshTokenStore;
    private final OauthAccountRepository oauthAccountRepository;
    private final OauthClientResolver oauthClientResolver;
    private final RejoinPolicy rejoinPolicy;
    private final StorageService storageService;

    public UserProfileResponse getProfile(Long userId) {
        return UserProfileResponse.from(findActiveById(userId));
    }

    /** GET /users/me/points — 잔액만. 프로필 전체를 받지 않아도 상점이 서버 값으로 갱신할 수 있게 한다. */
    public PointBalanceResponse getPointBalance(Long userId) {
        return new PointBalanceResponse(findActiveById(userId).getPointBalance());
    }

    /** GET /users/me/points/history — 적립·사용 내역(최신순). */
    public PointHistoryPageResponse getPointHistory(Long userId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"));
        return PointHistoryPageResponse.from(pointHistoryRepository.findByUserId(userId, pageable));
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
     * <p>preset을 주면 업로드 없이 기본 프로필 아이콘을 고른 것이고, 둘 다 비어 있으면
     * 아바타를 해제한다 — 선택·변경·삭제를 한 엔드포인트로 처리한다.</p>
     */
    @Transactional
    public UserProfileResponse updateAvatar(Long userId, UpdateAvatarRequest req) {
        User user = findActiveById(userId);
        String previousUrl = user.getAvatarUrl();

        user.changeAvatarUrl(resolveAvatarUrl(userId, req));

        // 이전 사진은 커밋된 뒤에 지운다. 트랜잭션 안에서 지우면 이후 롤백 시 아직 참조 중인
        // 객체를 이미 삭제한 상태가 되어 프로필 사진이 깨진다(삭제는 되돌릴 수 없다).
        // 기본 아이콘으로 바꾸는 경우에도 그 전에 쓰던 업로드 사진은 여기서 함께 정리된다.
        deleteAfterCommit(previousUrl);

        return UserProfileResponse.from(user);
    }

    /**
     * 요청 → 저장할 avatarUrl. key(업로드)와 preset(기본 아이콘)은 <b>동시에 올 수 없다</b> —
     * 둘 다 주면 어느 쪽이 이겼는지 화면에서 알 수 없어 조용히 하나를 고르는 대신 거절한다.
     */
    private String resolveAvatarUrl(Long userId, UpdateAvatarRequest req) {
        String key = trimToNull(req.key());
        String preset = trimToNull(req.preset());

        if (key != null && preset != null) {
            throw new BusinessException(ErrorCode.INVALID_INPUT);
        }
        if (preset != null) {
            if (!AVATAR_PRESET.matcher(preset).matches()) {
                throw new BusinessException(ErrorCode.INVALID_INPUT);
            }
            return AVATAR_PRESET_PATH + preset + ".png";
        }
        if (key != null) {
            return storageService.confirmOwned(UploadPurpose.AVATAR, userId, key);
        }
        return null; // 아바타 해제
    }

    /** 폼에서 빈 문자열이 올 수 있어 null과 같이 다룬다. */
    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
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
