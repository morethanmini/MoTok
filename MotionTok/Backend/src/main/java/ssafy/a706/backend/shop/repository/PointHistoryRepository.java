package ssafy.a706.backend.shop.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ssafy.a706.backend.shop.model.PointHistory;
import ssafy.a706.backend.shop.model.PointHistoryType;
import ssafy.a706.backend.shop.repository.dto.PointFlowSum;

public interface PointHistoryRepository extends JpaRepository<PointHistory, Long> {

    /** GET /users/me/points/history — 내 내역 페이지. 정렬은 호출 측 Pageable이 정한다. */
    Page<PointHistory> findByUserId(Long userId, Pageable pageable);

    /**
     * GET /v1/admin/points — 관리자 포인트 내역 조회(-106 후속).
     *
     * <p>적립·사용 방향을 {@code amount}의 부호로 가른다. 별도 컬럼을 두지 않은 건 원래 설계다 —
     * type만으로는 방향을 알 수 없고(AI_GENERATE는 차감, AI_GENERATE_REFUND는 환급),
     * 부호가 그 사실의 단일 원천이다.</p>
     *
     * <p>{@code earnedOnly}·{@code spentOnly}가 둘 다 false면 필터 없음이다. nullable Boolean
     * 하나로 받는 대신 플래그 두 개로 나눈 이유 — JPQL에서 {@code :param is null} 분기를 쓰면
     * 조건이 "널이 아니고 그리고 참이면"으로 두 겹이 되어 읽기 어려워진다.</p>
     */
    @Query("""
            select p from PointHistory p
            where (:userId is null or p.userId = :userId)
              and (:earnedOnly = false or p.amount > 0)
              and (:spentOnly = false or p.amount < 0)
              and (:type is null or p.type = :type)
            """)
    Page<PointHistory> search(@Param("userId") Long userId,
                              @Param("earnedOnly") boolean earnedOnly,
                              @Param("spentOnly") boolean spentOnly,
                              @Param("type") PointHistoryType type,
                              Pageable pageable);

    /**
     * 한 회원의 총 적립·총 사용. 페이지 합계가 아니라 <b>전체</b> 합계다 —
     * 관리자가 알고 싶은 건 "이 사람이 지금까지 얼마를 받아 갔고 얼마를 썼나"이고,
     * 그건 20건짜리 현재 페이지로는 답할 수 없다.
     */
    @Query("""
            select new ssafy.a706.backend.shop.repository.dto.PointFlowSum(
                       coalesce(sum(case when p.amount > 0 then p.amount else 0 end), 0L),
                       coalesce(sum(case when p.amount < 0 then -p.amount else 0 end), 0L))
            from PointHistory p
            where p.userId = :userId
            """)
    PointFlowSum sumFlowOf(@Param("userId") Long userId);
}
