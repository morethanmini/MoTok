package ssafy.a706.backend.report;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import ssafy.a706.backend.report.enums.ReportStatus;

import java.util.Collection;
import java.util.List;

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

    /**
     * 피신고자별 누적 신고 건수(많은 순). 신고 유저 목록(-105)의 절반이다 —
     * 나머지 절반은 {@link ChatReportRepository#countGroupedByReportedUser}가 준다.
     *
     * <p><b>기각(REJECTED)도 센다.</b> 관리자가 "누가 자주 신고당하나"를 보는 화면이고,
     * 기각을 빼면 판단 근거가 이미 내려진 판단으로 걸러진다 — 반복 신고 자체가 신호다.</p>
     */
    @Query("""
            select new ssafy.a706.backend.report.ReportCount(r.reportedUserId, count(r))
            from UserReport r group by r.reportedUserId order by count(r) desc
            """)
    List<ReportCount> countGroupedByReportedUser(Pageable pageable);

    /** 최근 신고 사유(최신순). 사용자별로 잘라 쓸 것이라 호출부가 상한을 정한다. */
    List<UserReport> findByReportedUserIdInOrderByIdDesc(Collection<Long> reportedUserIds, Pageable pageable);
}
