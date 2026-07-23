package ssafy.a706.backend.user.withdrawal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.Optional;

public interface WithdrawnAccountRepository extends JpaRepository<WithdrawnAccount, Long> {

    /** 아직 쿨다운이 남아 있는 기록 중 가장 늦게 풀리는 것 — 남은 기간 안내에 쓴다. */
    Optional<WithdrawnAccount> findTopByIdentifierHashAndRejoinAvailableAtAfterOrderByRejoinAvailableAtDesc(
            String identifierHash, LocalDateTime now);
}
