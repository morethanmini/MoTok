package ssafy.a706.backend.shop.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.shop.model.PointHistory;

public interface PointHistoryRepository extends JpaRepository<PointHistory, Long> {

    /** GET /users/me/points/history — 내 내역 페이지. 정렬은 호출 측 Pageable이 정한다. */
    Page<PointHistory> findByUserId(Long userId, Pageable pageable);
}
