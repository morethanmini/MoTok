package ssafy.a706.backend.shop.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import ssafy.a706.backend.shop.model.UserItem;

import java.util.Set;

public interface UserItemRepository extends JpaRepository<UserItem, Long> {

    boolean existsByUserIdAndItemId(Long userId, Long itemId);

    /** GET /shop/items의 owned 플래그 계산용 — 아이템별 존재 쿼리 N+1을 피하려고 한 번에 조회한다. */
    @Query("SELECT ui.itemId FROM UserItem ui WHERE ui.userId = :userId")
    Set<Long> findItemIdsByUserId(Long userId);
}
