package ssafy.a706.backend.decor.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.decor.model.DecorSetting;

public interface DecorSettingRepository extends JpaRepository<DecorSetting, Long> {
}
