package ssafy.a706.backend.shop.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import ssafy.a706.backend.shop.model.UserItem;
import ssafy.a706.backend.shop.repository.dto.OwnedItemRow;

import java.util.List;
import java.util.Set;

public interface UserItemRepository extends JpaRepository<UserItem, Long> {

    boolean existsByUserIdAndItemId(Long userId, Long itemId);

    /** GET /shop/items의 owned 플래그 계산용 — 아이템별 존재 쿼리 N+1을 피하려고 한 번에 조회한다. */
    @Query("SELECT ui.itemId FROM UserItem ui WHERE ui.userId = :userId")
    Set<Long> findItemIdsByUserId(Long userId);

    /** GET /users/me/inventory — 보유 기록에 아이템 정보를 붙여 한 번에 읽는다. 최근 획득 순. */
    @Query("""
            SELECT new ssafy.a706.backend.shop.repository.dto.OwnedItemRow(
                       ui.itemId, i.name, i.category, i.imageUrl, ui.acquiredAt)
            FROM UserItem ui JOIN Item i ON i.id = ui.itemId
            WHERE ui.userId = :userId AND i.active = true
            ORDER BY ui.acquiredAt DESC, ui.itemId DESC
            """)
    List<OwnedItemRow> findOwnedItems(Long userId);
}
