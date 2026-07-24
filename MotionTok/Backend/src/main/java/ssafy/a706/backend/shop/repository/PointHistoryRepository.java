package ssafy.a706.backend.shop.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.shop.model.PointHistory;

public interface PointHistoryRepository extends JpaRepository<PointHistory, Long> {
}
