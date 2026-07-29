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

    /**
     * PROCESSING → DONE 조건부 UPDATE. Item/UserItem 생성은 더 이상 여기서 하지 않는다 —
     * "생성 → 확인 → 저장" 흐름에서 지급은 유저가 /shop/ai-items/{jobId}/save를 눌러야 일어난다.
     * 이미 완료·실패 처리된 job에 대한 중복 complete 호출은 막는다.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AiItemJob j SET j.status = ssafy.a706.backend.shop.model.AiJobStatus.DONE, "
            + "j.imageUrl = :imageUrl, j.updatedAt = CURRENT_TIMESTAMP "
            + "WHERE j.id = :id AND j.status = ssafy.a706.backend.shop.model.AiJobStatus.PROCESSING")
    int completeWithImage(@Param("id") Long id, @Param("imageUrl") String imageUrl);

    /**
     * job에 생성된 Item을 원자적으로 연결한다(check-then-act 대신) — 동시 저장 요청에서 Item이
     * 두 번 지급되는 것을 막는다. itemId가 이미 있으면(먼저 저장된 경우) 영향 row가 0이 되어
     * 이번 요청은 뒤늦게 만든 Item을 아무에게도 지급하지 않고 버린다.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AiItemJob j SET j.itemId = :itemId, j.updatedAt = CURRENT_TIMESTAMP "
            + "WHERE j.id = :id AND j.itemId IS NULL")
    int attachItem(@Param("id") Long id, @Param("itemId") Long itemId);

    /** PROCESSING → FAILED 조건부 UPDATE. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AiItemJob j SET j.status = ssafy.a706.backend.shop.model.AiJobStatus.FAILED, "
            + "j.errorMessage = :message, j.updatedAt = CURRENT_TIMESTAMP "
            + "WHERE j.id = :id AND j.status = ssafy.a706.backend.shop.model.AiJobStatus.PROCESSING")
    int fail(@Param("id") Long id, @Param("message") String message);
}
