package ssafy.a706.backend.report;

import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.chat.ChatLogEntry;
import ssafy.a706.backend.chat.ChatLogRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import ssafy.a706.backend.report.dto.ChatContextEntry;
import ssafy.a706.backend.report.dto.ChatReportCreateRequest;
import ssafy.a706.backend.report.dto.ChatReportCreateResponse;
import ssafy.a706.backend.report.dto.ChatReportDetailResponse;
import ssafy.a706.backend.report.dto.ChatReportListResponse;
import ssafy.a706.backend.report.enums.ReportStatus;
import ssafy.a706.backend.signal.RoomMembershipReader;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;

/**
 * 채팅 신고(-132) — 신고 시점에 Redis Stream에서 대상 원문과 전후 맥락(±10)을 읽어
 * RDB에 통째로 영속한다. 방 폭파로 채팅이 사라지기 전의 증거 보전이 목적.
 * 원문·작성자를 클라이언트가 보내지 않으므로(요청은 roomId+chatId뿐) 조작 신고가 원천 차단된다.
 */
@Service
@RequiredArgsConstructor
public class ChatReportService {

    /** 전후 각 방향으로 담는 맥락 개수 — 대상 포함 최대 21건. */
    private static final int CONTEXT_RADIUS = 10;

    private final RoomMembershipReader membershipReader;
    private final ChatLogRepository chatLogRepository;
    private final ChatReportRepository chatReportRepository;
    private final ObjectMapper objectMapper;

    @Transactional
    public ChatReportCreateResponse create(ChatReportCreateRequest request, AuthPrincipal reporter) {
        // 신고는 회원 전용 — 게스트는 다인 방에 들어갈 수 없어 정상 흐름에선 도달하지 않는 방어 가드.
        if (reporter.isGuest()) {
            throw new BusinessException(ErrorCode.FORBIDDEN);
        }
        String roomId = request.roomId();
        if (!membershipReader.existsRoom(roomId)) {
            // 방 폭파 시 채팅 로그도 즉시 삭제되므로, 방이 없으면 신고도 불가가 정책이다.
            throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
        }
        if (!membershipReader.isMember(roomId, reporter.userId())) {
            throw new BusinessException(ErrorCode.CHAT_REPORT_NOT_IN_ROOM);
        }

        ChatLogEntry target = chatLogRepository.findById(roomId, request.chatId())
                .orElseThrow(() -> new BusinessException(ErrorCode.CHAT_MESSAGE_NOT_FOUND));
        if (target.userId().equals(reporter.userId())) {
            throw new BusinessException(ErrorCode.CHAT_REPORT_SELF);
        }
        if (chatReportRepository.existsByRoomIdAndChatIdAndReporterUserId(
                roomId, target.chatId(), memberId(reporter.userId()))) {
            throw new BusinessException(ErrorCode.CHAT_REPORT_DUPLICATE);
        }

        String contextJson = objectMapper.writeValueAsString(collectContext(roomId, target.chatId()));
        ChatReport report = ChatReport.builder()
                .roomId(roomId)
                .chatId(target.chatId())
                .reporterUserId(memberId(reporter.userId()))
                .reporterNickname(reporter.displayName())
                .reportedUserId(memberId(target.userId()))
                .reportedNickname(target.nickname())
                .reportedText(target.text())
                .reportedAt(target.sentAt())
                .contextJson(contextJson)
                .reason(request.reason())
                .reasonDetail(request.detail())
                .build();
        try {
            // UK(room_id, chat_id, reporter_user_id) 경합은 flush 시점에 드러나므로 즉시 flush해서 잡는다.
            ChatReport saved = chatReportRepository.saveAndFlush(report);
            return new ChatReportCreateResponse(saved.getId());
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(ErrorCode.CHAT_REPORT_DUPLICATE);
        }
    }

    /**
     * 대상 기준 이전 10 + 대상 + 이후 10을 시간순으로 병합한다.
     * findUpTo/findFrom 모두 대상을 포함하므로 이후 목록에서 첫 원소(대상)를 제외한다.
     * trim으로 이전 메시지가 밀려났으면 남은 만큼만 담는다.
     */
    private List<ChatContextEntry> collectContext(String roomId, String chatId) {
        List<ChatLogEntry> merged = new ArrayList<>(
                chatLogRepository.findUpTo(roomId, chatId, CONTEXT_RADIUS + 1));
        List<ChatLogEntry> after = chatLogRepository.findFrom(roomId, chatId, CONTEXT_RADIUS + 1);
        if (after.size() > 1) {
            merged.addAll(after.subList(1, after.size()));
        }
        return merged.stream().map(ChatContextEntry::from).toList();
    }

    /** 회원 userId 문자열 → users PK. 게스트 형식(guest-…)은 다인 방에 없어야 하므로 입력 오류로 처리. */
    private Long memberId(String userId) {
        try {
            return Long.valueOf(userId);
        } catch (NumberFormatException e) {
            throw new BusinessException(ErrorCode.INVALID_INPUT);
        }
    }

    // ---- 관리자(-133) — 인가는 SecurityConfig(/api/v1/admin/** hasRole ADMIN)가 필터 단에서 처리 ----

    /** 목록 — 최신 신고부터. status가 null이면 전체. */
    @Transactional(readOnly = true)
    public ChatReportListResponse list(ReportStatus status, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"));
        return ChatReportListResponse.from(status == null
                ? chatReportRepository.findAll(pageable)
                : chatReportRepository.findByStatus(status, pageable));
    }

    /** 상세 — 저장된 스냅샷(JSON)을 파싱해 시간순 배열로 돌려준다(채팅창 복원용). */
    @Transactional(readOnly = true)
    public ChatReportDetailResponse detail(Long reportId) {
        ChatReport report = findReport(reportId);
        List<ChatContextEntry> context = objectMapper.readValue(
                report.getContextJson(), new TypeReference<List<ChatContextEntry>>() {});
        return ChatReportDetailResponse.of(report, context);
    }

    /** 처리 상태 전이 — RECEIVED(초기 상태)로 되돌리는 요청은 거부한다. */
    @Transactional
    public void updateStatus(Long reportId, ReportStatus status) {
        if (status == ReportStatus.RECEIVED) {
            throw new BusinessException(ErrorCode.INVALID_INPUT);
        }
        findReport(reportId).updateStatus(status);
    }

    private ChatReport findReport(Long reportId) {
        return chatReportRepository.findById(reportId)
                .orElseThrow(() -> new BusinessException(ErrorCode.CHAT_REPORT_NOT_FOUND));
    }
}
