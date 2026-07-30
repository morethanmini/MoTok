package ssafy.a706.backend.report;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import ssafy.a706.backend.report.enums.ReportStatus;

import java.util.Collection;
import java.util.List;

public interface ChatReportRepository extends JpaRepository<ChatReport, Long> {

    boolean existsByRoomIdAndChatIdAndReporterUserId(String roomId, String chatId, Long reporterUserId);

    Page<ChatReport> findByStatus(ReportStatus status, Pageable pageable);

    /** 피신고자별 누적 채팅 신고 건수(많은 순). UserReportRepository의 같은 이름 쿼리와 합산한다. */
    @Query("""
            select new ssafy.a706.backend.report.ReportCount(r.reportedUserId, count(r))
            from ChatReport r group by r.reportedUserId order by count(r) desc
            """)
    List<ReportCount> countGroupedByReportedUser(Pageable pageable);

    /** 최근 채팅 신고 사유(최신순). 사용자별 상한은 호출부가 정한다. */
    List<ChatReport> findByReportedUserIdInOrderByIdDesc(Collection<Long> reportedUserIds, Pageable pageable);
}
