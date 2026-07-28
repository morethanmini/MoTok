package ssafy.a706.backend.shop.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.shop.model.GameRewardGrant;

public interface GameRewardGrantRepository extends JpaRepository<GameRewardGrant, Long> {

    boolean existsBySessionIdAndUserId(String sessionId, Long userId);
}
