package ssafy.a706.backend.report;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.report.enums.ReportStatus;

public interface ChatReportRepository extends JpaRepository<ChatReport, Long> {

    boolean existsByRoomIdAndChatIdAndReporterUserId(String roomId, String chatId, Long reporterUserId);

    Page<ChatReport> findByStatus(ReportStatus status, Pageable pageable);
}
