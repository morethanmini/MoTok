package ssafy.a706.backend.report;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import ssafy.a706.backend.chat.ChatLogRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.report.dto.ChatContextEntry;
import ssafy.a706.backend.report.dto.ChatReportDetailResponse;
import ssafy.a706.backend.report.dto.ChatReportListResponse;
import ssafy.a706.backend.report.enums.ReportReason;
import ssafy.a706.backend.report.enums.ReportStatus;
import ssafy.a706.backend.signal.RoomMembershipReader;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/** 관리자 신고 조회·처리(S15P11A706-133) 단위 테스트 — 목록 필터·스냅샷 복원·상태 전이. */
@ExtendWith(MockitoExtension.class)
class ChatReportAdminServiceTest {

    @Mock RoomMembershipReader membershipReader;
    @Mock ChatLogRepository chatLogRepository;
    @Mock ChatReportRepository chatReportRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private ChatReportService service;

    @BeforeEach
    void setUp() {
        service = new ChatReportService(membershipReader, chatLogRepository,
                chatReportRepository, objectMapper);
    }

    private ChatReport report(String contextJson) {
        return ChatReport.builder()
                .roomId("A1B2C3").chatId("1700000000005-0")
                .reporterUserId(1L).reporterNickname("신고자")
                .reportedUserId(2L).reportedNickname("피신고자")
                .reportedText("나쁜말").reportedAt(Instant.parse("2026-07-24T12:00:00Z"))
                .contextJson(contextJson)
                .reason(ReportReason.ABUSE).reasonDetail(null)
                .build();
    }

    @Test
    void 상세는_스냅샷_JSON을_시간순_배열로_복원한다() {
        List<ChatContextEntry> context = List.of(
                new ChatContextEntry("1700000000003-0", "TALK", "3", "닉3", "이전 말",
                        Instant.parse("2026-07-24T11:59:00Z")),
                new ChatContextEntry("1700000000005-0", "TALK", "2", "피신고자", "나쁜말",
                        Instant.parse("2026-07-24T12:00:00Z")));
        ChatReport report = report(objectMapper.writeValueAsString(context));
        when(chatReportRepository.findById(10L)).thenReturn(Optional.of(report));

        ChatReportDetailResponse detail = service.detail(10L);

        assertThat(detail.context()).hasSize(2);
        assertThat(detail.context().get(1).chatId()).isEqualTo(detail.chatId()); // 하이라이트 대상 매칭
        assertThat(detail.context().get(0).text()).isEqualTo("이전 말");
        assertThat(detail.status()).isEqualTo(ReportStatus.RECEIVED);
    }

    @Test
    void 없는_신고_조회는_CHAT_REPORT_NOT_FOUND() {
        when(chatReportRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.detail(99L))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.CHAT_REPORT_NOT_FOUND);
    }

    @Test
    void 상태를_REVIEWING으로_전이한다() {
        ChatReport report = report("[]");
        when(chatReportRepository.findById(10L)).thenReturn(Optional.of(report));

        service.updateStatus(10L, ReportStatus.REVIEWING);

        assertThat(report.getStatus()).isEqualTo(ReportStatus.REVIEWING);
    }

    @Test
    void RECEIVED로_되돌리는_요청은_거부한다() {
        assertThatThrownBy(() -> service.updateStatus(10L, ReportStatus.RECEIVED))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.INVALID_INPUT);
    }

    @Test
    void 목록은_status_필터를_적용하고_페이지_메타를_담는다() {
        ChatReport report = report("[]");
        when(chatReportRepository.findByStatus(eq(ReportStatus.RECEIVED), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(report), PageRequest.of(0, 20), 1));

        ChatReportListResponse result = service.list(ReportStatus.RECEIVED, 0, 20);

        assertThat(result.reports()).hasSize(1);
        assertThat(result.reports().get(0).reportedNickname()).isEqualTo("피신고자");
        assertThat(result.totalElements()).isEqualTo(1);
        assertThat(result.page()).isZero();
    }

    @Test
    void status_없이_조회하면_전체_목록이다() {
        when(chatReportRepository.findAll(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(report("[]"), report("[]")), PageRequest.of(0, 20), 2));

        assertThat(service.list(null, 0, 20).reports()).hasSize(2);
    }
}
