package ssafy.a706.backend.report;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.report.enums.ReportStatus;

import java.util.Collection;

public interface UserReportRepository extends JpaRepository<UserReport, Long> {

    /** 관리자 목록(-112) 상태 필터 조회. 필터가 없으면 findAll(pageable)을 쓴다. */
    Page<UserReport> findByStatus(ReportStatus status, Pageable pageable);

    /**
     * 같은 사람이 같은 대상을 <b>처리 안 된 상태로</b> 또 신고했는지.
     *
     * <p>UNIQUE 제약을 걸지 않는 이유 — (reporter, reported) 유일이면 한 번 신고한 상대는
     * 관리자가 처리를 끝낸 뒤에도 영영 다시 신고할 수 없다. 반복 가해가 실제로 일어나는데
     * 신고 통로가 막히는 쪽이 중복 행 몇 개보다 나쁘다.</p>
     */
    boolean existsByReporterUserIdAndReportedUserIdAndStatusIn(
            Long reporterUserId, Long reportedUserId, Collection<ReportStatus> statuses);
}
