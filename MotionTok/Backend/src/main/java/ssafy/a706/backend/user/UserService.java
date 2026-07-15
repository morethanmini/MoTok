package ssafy.a706.backend.user;

import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.dto.UserRegisterRequest;
import ssafy.a706.backend.user.dto.UserResponse;
import ssafy.a706.backend.user.dto.UserUpdateRequest;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public boolean isUserIdAvailable(String userId) {
        return !userRepository.existsByUserId(userId);
    }

    @Transactional
    public UserResponse register(UserRegisterRequest req) {
        if (userRepository.existsByUserId(req.userId())) {
            throw new BusinessException(ErrorCode.DUPLICATE_USER_ID);
        }
        User user = User.builder()
                .userId(req.userId())
                .password(passwordEncoder.encode(req.password()))
                .nickname(req.nickname())
                .build();
        return UserResponse.from(userRepository.save(user));
    }

    public UserResponse getByUserId(String userId) {
        return UserResponse.from(findByUserId(userId));
    }

    @Transactional
    public UserResponse update(String userId, UserUpdateRequest req) {
        User user = findByUserId(userId);
        if (req.nickname() != null && !req.nickname().isBlank()) {
            user.changeNickname(req.nickname());
        }
        if (req.password() != null && !req.password().isBlank()) {
            user.changePassword(passwordEncoder.encode(req.password()));
        }
        return UserResponse.from(user);
    }

    @Transactional
    public void delete(String userId) {
        userRepository.delete(findByUserId(userId));
    }

    public User findByUserId(String userId) {
        return userRepository.findByUserId(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
    }
}
