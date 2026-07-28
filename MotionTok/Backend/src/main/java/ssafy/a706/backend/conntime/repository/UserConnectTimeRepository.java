package ssafy.a706.backend.conntime.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.conntime.entity.UserConnectTime;

/** 누적 접속시간 upsert·조회(-141). PK가 user_id라 findById가 곧 회원 조회다. */
public interface UserConnectTimeRepository extends JpaRepository<UserConnectTime, Long> {
}
