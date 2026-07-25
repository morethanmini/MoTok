package ssafy.a706.backend.report;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.chat.ChatLogEntry;
import ssafy.a706.backend.chat.ChatLogRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.report.dto.ChatReportCreateRequest;
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
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 채팅 신고(S15P11A706-132) 단위 테스트 — 검증 순서·전후 맥락 병합·스냅샷 필드 확정 로직.
 * Redis/DB는 목으로 대체한다(흐름 전체는 통합 환경에서 별도 확인).
 */
@ExtendWith(MockitoExtension.class)
class ChatReportServiceTest {

    private static final String ROOM_ID = "A1B2C3";
    private static final String CHAT_ID = "1700000000005-0";
    private static final MemberPrincipal REPORTER = new MemberPrincipal(1L, "신고자");

    @Mock RoomMembershipReader membershipReader;
    @Mock ChatLogRepository chatLogRepository;
    @Mock ChatReportRepository chatReportRepository;

    private ChatReportService service;

    @BeforeEach
    void setUp() {
        service = new ChatReportService(membershipReader, chatLogRepository,
                chatReportRepository, new ObjectMapper());
    }

    private ChatReportCreateRequest request() {
        return new ChatReportCreateRequest(ROOM_ID, CHAT_ID, ReportReason.ABUSE, "심한 욕설");
    }

    private ChatLogEntry entry(String chatId, String userId, String text) {
        return new ChatLogEntry(chatId, "TALK", userId, "닉" + userId, text,
                Instant.parse("2026-07-24T12:00:00Z"));
    }

    private void givenValidRoomAndTarget(ChatLogEntry target) {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(ROOM_ID, REPORTER.userId())).thenReturn(true);
        when(chatLogRepository.findById(ROOM_ID, CHAT_ID)).thenReturn(Optional.of(target));
    }

    @Test
    void 신고하면_전후_맥락과_함께_저장되고_대상이_스냅샷에_포함된다() {
        ChatLogEntry target = entry(CHAT_ID, "2", "나쁜말");
        givenValidRoomAndTarget(target);
        when(chatReportRepository.existsByRoomIdAndChatIdAndReporterUserId(ROOM_ID, CHAT_ID, 1L))
                .thenReturn(false);
        // 이전 2 + 대상, 대상 + 이후 1 — 병합하면 시간순 4건이어야 한다(대상 중복 없이).
        when(chatLogRepository.findUpTo(ROOM_ID, CHAT_ID, 11)).thenReturn(List.of(
                entry("1700000000001-0", "1", "먼저 한 말"),
                entry("1700000000003-0", "3", "다른 사람 말"),
                target));
        when(chatLogRepository.findFrom(ROOM_ID, CHAT_ID, 11)).thenReturn(List.of(
                target,
                entry("1700000000007-0", "1", "받아친 말")));
        ChatReport saved = mock(ChatReport.class);
        when(saved.getId()).thenReturn(77L);
        when(chatReportRepository.saveAndFlush(any())).thenReturn(saved);

        Long reportId = service.create(request(), REPORTER).reportId();

        assertThat(reportId).isEqualTo(77L);
        ArgumentCaptor<ChatReport> captor = ArgumentCaptor.forClass(ChatReport.class);
        verify(chatReportRepository).saveAndFlush(captor.capture());
        ChatReport report = captor.getValue();
        assertThat(report.getRoomId()).isEqualTo(ROOM_ID);
        assertThat(report.getChatId()).isEqualTo(CHAT_ID);
        assertThat(report.getReporterUserId()).isEqualTo(1L);
        assertThat(report.getReportedUserId()).isEqualTo(2L);
        assertThat(report.getReportedNickname()).isEqualTo("닉2");
        assertThat(report.getReportedText()).isEqualTo("나쁜말");
        assertThat(report.getStatus()).isEqualTo(ReportStatus.RECEIVED);
        // 스냅샷: 시간순 4건(이전2 + 대상 + 이후1), 대상 chatId가 정확히 1번 포함
        assertThat(report.getContextJson())
                .contains("1700000000001-0")
                .contains("1700000000003-0")
                .contains("1700000000007-0")
                .containsOnlyOnce(CHAT_ID)
                .contains("나쁜말");
    }

    @Test
    void 자기_채팅은_신고할_수_없다() {
        givenValidRoomAndTarget(entry(CHAT_ID, REPORTER.userId(), "내가 한 말"));

        assertThatThrownBy(() -> service.create(request(), REPORTER))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.CHAT_REPORT_SELF);
        verify(chatReportRepository, never()).saveAndFlush(any());
    }

    @Test
    void 대상_채팅이_없으면_CHAT_MESSAGE_NOT_FOUND() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(ROOM_ID, REPORTER.userId())).thenReturn(true);
        when(chatLogRepository.findById(ROOM_ID, CHAT_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.create(request(), REPORTER))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.CHAT_MESSAGE_NOT_FOUND);
    }

    @Test
    void 이미_신고한_채팅이면_CHAT_REPORT_DUPLICATE() {
        givenValidRoomAndTarget(entry(CHAT_ID, "2", "나쁜말"));
        when(chatReportRepository.existsByRoomIdAndChatIdAndReporterUserId(ROOM_ID, CHAT_ID, 1L))
                .thenReturn(true);

        assertThatThrownBy(() -> service.create(request(), REPORTER))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.CHAT_REPORT_DUPLICATE);
        verify(chatLogRepository, never()).findUpTo(anyString(), anyString(), anyInt());
    }

    @Test
    void 방이_없으면_ROOM_NOT_FOUND_방_폭파_후_신고_불가_정책() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(false);

        assertThatThrownBy(() -> service.create(request(), REPORTER))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.ROOM_NOT_FOUND);
    }

    @Test
    void 방_참가자가_아니면_CHAT_REPORT_NOT_IN_ROOM() {
        when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        when(membershipReader.isMember(ROOM_ID, REPORTER.userId())).thenReturn(false);

        assertThatThrownBy(() -> service.create(request(), REPORTER))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.CHAT_REPORT_NOT_IN_ROOM);
    }

    @Test
    void 게스트는_신고할_수_없다() {
        assertThatThrownBy(() -> service.create(request(), new GuestPrincipal("guest-ab12cd34", "게스트1234")))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.FORBIDDEN);
    }

    @Test
    void 이전_메시지가_없어도_남은_맥락만으로_저장된다() {
        ChatLogEntry target = entry(CHAT_ID, "2", "첫 마디부터 욕설");
        givenValidRoomAndTarget(target);
        when(chatReportRepository.existsByRoomIdAndChatIdAndReporterUserId(ROOM_ID, CHAT_ID, 1L))
                .thenReturn(false);
        when(chatLogRepository.findUpTo(ROOM_ID, CHAT_ID, 11)).thenReturn(List.of(target));
        when(chatLogRepository.findFrom(ROOM_ID, CHAT_ID, 11)).thenReturn(List.of(target));
        ChatReport saved = mock(ChatReport.class);
        when(saved.getId()).thenReturn(1L);
        when(chatReportRepository.saveAndFlush(any())).thenReturn(saved);

        service.create(request(), REPORTER);

        ArgumentCaptor<ChatReport> captor = ArgumentCaptor.forClass(ChatReport.class);
        verify(chatReportRepository).saveAndFlush(captor.capture());
        assertThat(captor.getValue().getContextJson()).containsOnlyOnce(CHAT_ID);
    }
}
