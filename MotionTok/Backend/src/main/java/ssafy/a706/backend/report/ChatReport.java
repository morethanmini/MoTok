package ssafy.a706.backend.report;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import ssafy.a706.backend.global.entity.BaseTimeEntity;
import ssafy.a706.backend.report.enums.ReportReason;
import ssafy.a706.backend.report.enums.ReportStatus;

import java.time.Instant;

/**
 * 채팅 신고(-132) — Redis 채팅은 방 폭파 시 사라지므로 신고 시점에 원문·전후 맥락을 통째로 영속한다.
 * 방·유저는 FK 없이 값으로 저장한다: 방은 휘발성(Redis)이고, 닉네임은 변경·탈퇴 후에도
 * 신고 시점 표시명을 보존해야 하기 때문(신고는 회원 전용 — 게스트는 다인 방 입장 불가).
 * created_at(BaseTimeEntity)이 신고 일시, reported_at은 신고된 채팅의 발신 시각이다.
 */
@Entity
@Table(name = "chat_reports", uniqueConstraints = @UniqueConstraint(
        name = "uk_chat_report_room_chat_reporter",
        columnNames = {"room_id", "chat_id", "reporter_user_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ChatReport extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "room_id", nullable = false, length = 6)
    private String roomId;

    /** Redis Stream 엔트리 ID(예: 1690001234567-0). */
    @Column(name = "chat_id", nullable = false, length = 32)
    private String chatId;

    @Column(name = "reporter_user_id", nullable = false)
    private Long reporterUserId;

    @Column(name = "reporter_nickname", nullable = false, length = 32)
    private String reporterNickname;

    @Column(name = "reported_user_id", nullable = false)
    private Long reportedUserId;

    @Column(name = "reported_nickname", nullable = false, length = 32)
    private String reportedNickname;

    /** 신고 대상 채팅 원문(채팅 상한 500자와 동일). */
    @Column(name = "reported_text", nullable = false, length = 500)
    private String reportedText;

    /** 신고된 채팅의 발신 시각(sentAt). */
    @Column(name = "reported_at", nullable = false)
    private Instant reportedAt;

    /**
     * 전후 맥락 스냅샷 — {chatId,type,userId,nickname,text,sentAt} 시간순 JSON 배열(신고 대상 포함).
     * 관리자 화면은 이 배열을 순서대로 렌더링해 채팅창을 복원하고, chatId 일치 행을 하이라이트한다.
     */
    @Column(name = "context_json", nullable = false, columnDefinition = "TEXT")
    private String contextJson;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ReportReason reason;

    @Column(name = "reason_detail", length = 200)
    private String reasonDetail;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ReportStatus status;

    @Builder
    public ChatReport(String roomId, String chatId,
                      Long reporterUserId, String reporterNickname,
                      Long reportedUserId, String reportedNickname,
                      String reportedText, Instant reportedAt, String contextJson,
                      ReportReason reason, String reasonDetail) {
        this.roomId = roomId;
        this.chatId = chatId;
        this.reporterUserId = reporterUserId;
        this.reporterNickname = reporterNickname;
        this.reportedUserId = reportedUserId;
        this.reportedNickname = reportedNickname;
        this.reportedText = reportedText;
        this.reportedAt = reportedAt;
        this.contextJson = contextJson;
        this.reason = reason;
        this.reasonDetail = reasonDetail;
        this.status = ReportStatus.RECEIVED;
    }

    /** 관리자 처리(-133) — 상태 전이 외 필드는 불변이다. */
    public void updateStatus(ReportStatus status) {
        this.status = status;
    }
}
