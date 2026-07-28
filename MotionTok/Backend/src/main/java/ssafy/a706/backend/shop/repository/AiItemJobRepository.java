package ssafy.a706.backend.shop.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ssafy.a706.backend.shop.model.AiItemJob;
import ssafy.a706.backend.shop.model.AiJobStatus;

import java.util.Optional;

public interface AiItemJobRepository extends JpaRepository<AiItemJob, Long> {

    /** GET /internal/ai-jobs/next — 가장 오래된 PENDING 후보 1건. */
    Optional<AiItemJob> findFirstByStatusOrderByCreatedAtAsc(AiJobStatus status);

    /**
     * PENDING → PROCESSING 조건부 UPDATE (check-then-act 대신 원자 처리) —
     * UserRepository.deductPointsIfSufficient와 같은 패턴. 영향 row가 0이면 다른 워커가 먼저
     * 가져간 것이므로 이번 폴링은 빈 응답으로 끝내고 다음 폴링에서 다시 시도한다.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AiItemJob j SET j.status = ssafy.a706.backend.shop.model.AiJobStatus.PROCESSING, "
            + "j.updatedAt = CURRENT_TIMESTAMP "
            + "WHERE j.id = :id AND j.status = ssafy.a706.backend.shop.model.AiJobStatus.PENDING")
    int claim(@Param("id") Long id);

    /** PROCESSING → DONE 조건부 UPDATE. 이미 완료·실패 처리된 job에 대한 중복 complete 호출을 막는다. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AiItemJob j SET j.status = ssafy.a706.backend.shop.model.AiJobStatus.DONE, "
            + "j.itemId = :itemId, j.updatedAt = CURRENT_TIMESTAMP "
            + "WHERE j.id = :id AND j.status = ssafy.a706.backend.shop.model.AiJobStatus.PROCESSING")
    int complete(@Param("id") Long id, @Param("itemId") Long itemId);

    /** PROCESSING → FAILED 조건부 UPDATE. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AiItemJob j SET j.status = ssafy.a706.backend.shop.model.AiJobStatus.FAILED, "
            + "j.errorMessage = :message, j.updatedAt = CURRENT_TIMESTAMP "
            + "WHERE j.id = :id AND j.status = ssafy.a706.backend.shop.model.AiJobStatus.PROCESSING")
    int fail(@Param("id") Long id, @Param("message") String message);
}
