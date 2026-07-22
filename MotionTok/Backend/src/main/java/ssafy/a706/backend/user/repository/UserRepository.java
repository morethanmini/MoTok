package ssafy.a706.backend.user.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.user.entity.User;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    Optional<User> findByNickname(String nickname);

    boolean existsByEmail(String email);

    boolean existsByNickname(String nickname);

    /** 닉네임 변경 중복 검사용 — 대소문자만 바꾸는 경우(CI 콜레이션) 본인 행이 걸리지 않도록 자신을 제외한다. */
    boolean existsByNicknameAndIdNot(String nickname, Long id);
}
