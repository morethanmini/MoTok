package ssafy.a706.backend.user.service;

import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.oauth.repository.OauthAccountRepository;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;
import ssafy.a706.backend.user.repository.UserRepository;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final RefreshTokenStore refreshTokenStore;
    private final OauthAccountRepository oauthAccountRepository;

    public UserProfileResponse getProfile(Long userId) {
        return UserProfileResponse.from(findActiveById(userId));
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
     * DELETE /users/me — soft delete(닉네임·이메일 치환 포함) 후 Refresh 토큰을 무효화한다.
     * DB 반영(flush)을 먼저 확정한 뒤에만 Redis 부수효과를 실행한다 — 실패 시 반쪽 탈퇴 방지.
     * 이미 DELETED인 계정의 재호출은 같은 치환값으로 멱등하게 204가 된다.
     */
    @Transactional
    public void withdraw(Long userId) {
        User user = findById(userId);
        user.softDelete();
        userRepository.saveAndFlush(user);
        oauthAccountRepository.deleteByUser(user); // 소셜 연동 해제 — 탈퇴 후 같은 소셜 계정으로 신규 가입 가능
        refreshTokenStore.delete(userId);
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
