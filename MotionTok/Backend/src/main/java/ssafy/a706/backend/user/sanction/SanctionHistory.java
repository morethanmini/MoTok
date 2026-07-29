package ssafy.a706.backend.user.sanction;

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
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 계정 제재 이력 — 누가 누구를 언제 왜 얼마나 제재했는지의 영구 기록.
 *
 * <p><b>정지 상태 자체는 여기 없다.</b> "지금 정지 중인가"는 Redis TTL
 * ({@link ssafy.a706.backend.auth.store.AccountBlockStore})이 답하고, 이 테이블은 그 TTL이
 * 만료돼 사라진 뒤에도 남아야 하는 사실만 담는다. 둘을 한 곳에 합치면 둘 중 하나를 잃는다 —
 * TTL에 이력을 담으면 만료와 함께 증발하고, 테이블에 상태를 담으면 만료를 되돌릴 배치가 필요해진다.</p>
 *
 * <p>{@code PointHistory}와 같은 append-only 테이블이다. <b>제재 사실은 한 번 쓰이면 바뀌지 않는다</b> —
 * 수정자도 {@code BaseTimeEntity}의 updatedAt도 두지 않아, 이력이 나중에 고쳐질 수 있다는 여지를 없앤다.
 * 제재를 정정할 때도 기존 행을 고치는 대신 RELEASE·UNBAN 행을 새로 쌓는다.</p>
 *
 * <p>{@link #acknowledgedAt}만 예외다. 이건 제재 사실이 아니라 <b>전달 확인</b>이라 성질이 다르다 —
 * 경고는 접근을 막지 않으므로 당사자가 읽었는지가 곧 제재가 실행됐는지다. 푸시는 접속 중이
 * 아니면 조용히 폐기되므로({@code UserNotifier} 주석) 확인 시각을 서버가 들고 있어야
 * "아직 못 본 경고"를 다음 접속 때 다시 띄울 수 있다.</p>
 *
 * <p>닉네임은 {@code UserReport}와 같은 이유로 시점 스냅샷이다. 대상이 닉네임을 바꾸거나 탈퇴해도
 * "누구에게 내린 제재였는지"가 남아야 관리자가 과거 기록을 읽을 수 있다.</p>
 */
@Entity
@Table(name = "sanction_history", indexes = {
        // 관리자 화면은 "이 사용자의 제재 이력"으로만 조회한다(누적 횟수 집계도 같은 조합).
        @Index(name = "ix_sanction_user", columnList = "user_id")
})
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SanctionHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "user_nickname", nullable = false, length = 32)
    private String userNickname;

    @Column(name = "admin_user_id", nullable = false)
    private Long adminUserId;

    @Column(name = "admin_nickname", nullable = false, length = 32)
    private String adminNickname;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private SanctionType type;

    /** 정지 일수. RELEASE는 기간 개념이 없어 null이다. */
    @Column(name = "days")
    private Integer days;

    @Column(nullable = false, length = 200)
    private String reason;

    /**
     * 근거가 된 신고의 id. 관리자 직권 제재는 null이라 FK로 묶지 않는다.
     * <b>{@link #refReportType}과 반드시 함께 채워진다</b> — 유형 없이는 어느 테이블의 id인지 알 수 없다.
     */
    @Column(name = "ref_report_id")
    private Long refReportId;

    /** 위 id가 사용자 신고인지 채팅 신고인지. id가 null이면 이것도 null이다. */
    @Enumerated(EnumType.STRING)
    @Column(name = "ref_report_type", length = 16)
    private SanctionRefType refReportType;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 당사자가 경고를 확인한 시각. WARN 외의 유형은 항상 null이다 —
     * 정지·밴은 읽든 말든 접근이 막히므로 확인 여부가 제재의 성립과 무관하다.
     */
    @Column(name = "acknowledged_at")
    private LocalDateTime acknowledgedAt;

    private SanctionHistory(Long userId, String userNickname, Long adminUserId, String adminNickname,
                            SanctionType type, Integer days, String reason,
                            Long refReportId, SanctionRefType refReportType) {
        this.userId = userId;
        this.userNickname = userNickname;
        this.adminUserId = adminUserId;
        this.adminNickname = adminNickname;
        this.type = type;
        this.days = days;
        this.reason = reason;
        this.refReportId = refReportId;
        this.refReportType = refReportType;
        this.createdAt = LocalDateTime.now();
    }

    public static SanctionHistory suspend(Long userId, String userNickname,
                                          Long adminUserId, String adminNickname,
                                          int days, String reason,
                                          Long refReportId, SanctionRefType refReportType) {
        return new SanctionHistory(userId, userNickname, adminUserId, adminNickname,
                SanctionType.SUSPEND, days, reason, refReportId, refReportType);
    }

    public static SanctionHistory release(Long userId, String userNickname,
                                          Long adminUserId, String adminNickname, String reason) {
        return new SanctionHistory(userId, userNickname, adminUserId, adminNickname,
                SanctionType.RELEASE, null, reason, null, null);
    }

    /** 영구 정지 — 기간 개념이 없어 days는 null이다(그게 기간 정지와의 차이다). */
    public static SanctionHistory ban(Long userId, String userNickname,
                                      Long adminUserId, String adminNickname, String reason,
                                      Long refReportId, SanctionRefType refReportType) {
        return new SanctionHistory(userId, userNickname, adminUserId, adminNickname,
                SanctionType.BAN, null, reason, refReportId, refReportType);
    }

    public static SanctionHistory unban(Long userId, String userNickname,
                                        Long adminUserId, String adminNickname, String reason) {
        return new SanctionHistory(userId, userNickname, adminUserId, adminNickname,
                SanctionType.UNBAN, null, reason, null, null);
    }

    /** 경고 — 기간도 차단도 없다. 남는 것은 이력과 당사자에게 전달되는 사실뿐이다. */
    public static SanctionHistory warn(Long userId, String userNickname,
                                       Long adminUserId, String adminNickname, String reason,
                                       Long refReportId, SanctionRefType refReportType) {
        return new SanctionHistory(userId, userNickname, adminUserId, adminNickname,
                SanctionType.WARN, null, reason, refReportId, refReportType);
    }

    /**
     * 당사자가 읽었다고 표시한다. <b>멱등이다</b> — 여러 탭에서 확인을 눌러도 처음 시각을 유지한다.
     * 나중 시각으로 덮으면 "언제 전달됐나"가 마지막 클릭 시점으로 바뀐다.
     */
    public void acknowledge() {
        if (this.acknowledgedAt == null) {
            this.acknowledgedAt = LocalDateTime.now();
        }
    }

    public boolean isAcknowledged() {
        return this.acknowledgedAt != null;
    }
}
