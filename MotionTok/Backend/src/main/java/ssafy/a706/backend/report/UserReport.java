package ssafy.a706.backend.report;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import ssafy.a706.backend.global.entity.BaseTimeEntity;
import ssafy.a706.backend.report.enums.ReportReason;
import ssafy.a706.backend.report.enums.ReportStatus;

/**
 * 사용자 신고(-112) — 프로필에서 특정 회원을 신고한 기록.
 *
 * <p>채팅 신고({@link ChatReport})와 나누는 이유는 <b>증거의 성격이 다르기</b> 때문이다.
 * 채팅 신고는 Redis에서 사라질 원문·전후 맥락을 스냅샷으로 떠 와야 하지만, 사용자 신고는
 * "이 사람이 이런 사유로 신고됐다"는 사실 자체가 기록이다. 한 테이블에 억지로 합치면
 * 채팅 전용 컬럼(room_id·chat_id·context_json)이 전부 nullable이 되어 무엇이 필수인지 사라진다.</p>
 *
 * <p>신고자·피신고자는 FK 없이 값으로 저장하고 닉네임을 함께 스냅샷한다 —
 * 닉네임이 바뀌거나 계정이 탈퇴해도 신고 시점의 표시명이 남아야 관리자가 판단할 수 있다.
 * (chat_reports와 같은 정책)</p>
 */
@Entity
@Table(name = "user_reports", indexes = {
        // 관리자 목록은 피신고자별로 몰아 보는 일이 잦고, 중복 신고 검사도 이 조합으로 조회한다.
        @Index(name = "ix_user_report_reported", columnList = "reported_user_id"),
        @Index(name = "ix_user_report_reporter", columnList = "reporter_user_id")
})
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserReport extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "reporter_user_id", nullable = false)
    private Long reporterUserId;

    @Column(name = "reporter_nickname", nullable = false, length = 32)
    private String reporterNickname;

    @Column(name = "reported_user_id", nullable = false)
    private Long reportedUserId;

    @Column(name = "reported_nickname", nullable = false, length = 32)
    private String reportedNickname;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ReportReason reason;

    /** 직접 입력 사유(명세 reasonText). 선택형 사유만으로 부족할 때 채운다. */
    @Column(name = "reason_detail", length = 200)
    private String reasonDetail;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ReportStatus status;

    @Builder
    public UserReport(Long reporterUserId, String reporterNickname,
                      Long reportedUserId, String reportedNickname,
                      ReportReason reason, String reasonDetail) {
        this.reporterUserId = reporterUserId;
        this.reporterNickname = reporterNickname;
        this.reportedUserId = reportedUserId;
        this.reportedNickname = reportedNickname;
        this.reason = reason;
        this.reasonDetail = reasonDetail;
        this.status = ReportStatus.RECEIVED;
    }

    /** 아직 관리자가 손대지 않았거나 검토 중 — 이 상태의 신고가 있으면 같은 대상을 다시 신고할 수 없다. */
    public boolean isOpen() {
        return status == ReportStatus.RECEIVED || status == ReportStatus.REVIEWING;
    }

    /** 관리자 처리(-133과 같은 규칙) — 상태 전이 외 필드는 불변이다. */
    public void updateStatus(ReportStatus status) {
        this.status = status;
    }
}
