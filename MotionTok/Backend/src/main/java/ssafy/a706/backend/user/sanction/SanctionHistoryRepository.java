package ssafy.a706.backend.user.sanction;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SanctionHistoryRepository extends JpaRepository<SanctionHistory, Long> {

    Page<SanctionHistory> findByUserId(Long userId, Pageable pageable);

    /** 누적 정지 횟수 — 반복 위반자에게 더 긴 기간을 매길 때 관리자가 보는 값이다. */
    long countByUserIdAndType(Long userId, SanctionType type);

    /**
     * 아직 확인하지 않은 경고(오래된 것부터).
     *
     * <p>푸시는 그 순간 접속 중이 아니면 폐기되므로({@code UserNotifier} 주석) 이 조회가
     * 놓친 경고를 메우는 경로다. 오래된 것부터 주는 이유 — 여러 건이 쌓였을 때 받은 순서대로
     * 보여 줘야 무엇 때문에 경고가 반복됐는지 읽힌다.</p>
     */
    List<SanctionHistory> findByUserIdAndTypeAndAcknowledgedAtIsNullOrderByIdAsc(
            Long userId, SanctionType type);

    /** 확인 처리 대상 — 남의 경고를 확인할 수 없도록 userId까지 조건에 넣는다. */
    Optional<SanctionHistory> findByIdAndUserIdAndType(Long id, Long userId, SanctionType type);

    /**
     * 주어진 신고들 중 실제 제재로 이어진 것의 id.
     *
     * <p>관리자 목록에서 "종결"만으로는 제재하고 닫은 건과 그냥 닫은 건이 구분되지 않아,
     * 한 페이지분 id를 한 번에 물어본다(행마다 조회하면 20번이 된다).</p>
     *
     * <p>{@code refReportType}까지 조건에 넣는 이유 — 사용자 신고와 채팅 신고는 id가 각각
     * 1부터 증가하므로 유형을 빼면 <b>다른 목록의 7번</b>이 제재된 것으로 뜬다.</p>
     */
    @Query("""
            select distinct h.refReportId from SanctionHistory h
            where h.refReportType = :type and h.refReportId in :reportIds
            """)
    List<Long> findSanctionedReportIds(@Param("type") SanctionRefType type,
                                       @Param("reportIds") Collection<Long> reportIds);
}
