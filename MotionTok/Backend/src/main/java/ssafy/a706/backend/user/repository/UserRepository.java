package ssafy.a706.backend.user.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.user.entity.User;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    boolean existsByNickname(String nickname);
}
