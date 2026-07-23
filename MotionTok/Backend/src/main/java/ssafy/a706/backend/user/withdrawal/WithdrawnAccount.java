package ssafy.a706.backend.user.withdrawal;

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
 * 탈퇴 계정의 재가입 제한 기록 (-111).
 *
 * 탈퇴하면 USER의 email·nickname은 tombstone으로 치환돼 원래 값이 남지 않으므로,
 * "탈퇴 후 1주일 재가입 금지"를 판정할 근거를 여기에 따로 남긴다.
 * 식별자는 원문 대신 SHA-256 해시로 저장한다 — 재가입 시도 시 동일성 비교만 하면 되고,
 * 탈퇴로 지운 개인정보(이메일·소셜 UID)를 평문으로 되살려 두지 않기 위해서다.
 *
 * 한 사용자가 이메일 1건 + 연동된 소셜 계정 수만큼의 행을 남긴다.
 * 쿨다운이 지난 행은 판정에 걸리지 않으며, 필요 시 배치로 정리할 수 있다.
 */
@Entity
@Table(name = "withdrawn_accounts",
        indexes = @Index(name = "ix_withdrawn_identifier_hash", columnList = "identifier_hash"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class WithdrawnAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** SHA-256(정규화된 식별자) hex. 이메일은 소문자 trim, 소셜은 "provider:providerUid". */
    @Column(name = "identifier_hash", nullable = false, length = 64)
    private String identifierHash;

    @Enumerated(EnumType.STRING)
    @Column(name = "identifier_type", nullable = false, length = 16)
    private WithdrawnIdentifierType identifierType;

    @Column(name = "withdrawn_at", nullable = false)
    private LocalDateTime withdrawnAt;

    /** 이 시각 이후부터 같은 식별자로 다시 가입할 수 있다. */
    @Column(name = "rejoin_available_at", nullable = false)
    private LocalDateTime rejoinAvailableAt;

    private WithdrawnAccount(String identifierHash, WithdrawnIdentifierType identifierType,
                             LocalDateTime withdrawnAt, LocalDateTime rejoinAvailableAt) {
        this.identifierHash = identifierHash;
        this.identifierType = identifierType;
        this.withdrawnAt = withdrawnAt;
        this.rejoinAvailableAt = rejoinAvailableAt;
    }

    public static WithdrawnAccount of(String identifierHash, WithdrawnIdentifierType type,
                                      LocalDateTime withdrawnAt, LocalDateTime rejoinAvailableAt) {
        return new WithdrawnAccount(identifierHash, type, withdrawnAt, rejoinAvailableAt);
    }
}
