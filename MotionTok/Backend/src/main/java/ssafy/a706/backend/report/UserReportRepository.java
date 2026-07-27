package ssafy.a706.backend.report;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.report.enums.ReportStatus;

import java.util.Collection;

public interface UserReportRepository extends JpaRepository<UserReport, Long> {

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
