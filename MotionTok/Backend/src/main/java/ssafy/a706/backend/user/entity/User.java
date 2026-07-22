package ssafy.a706.backend.user.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import ssafy.a706.backend.global.entity.BaseTimeEntity;
import ssafy.a706.backend.user.enums.UserRole;
import ssafy.a706.backend.user.enums.UserStatus;

import java.time.LocalDateTime;

/**
 * ERD v0.2 USER 테이블.
 * email·password_hash는 소셜 전용 계정을 위해 null을 허용한다.
 */
@Entity
@Table(name = "users")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, length = 100)
    private String email;

    @Column(name = "password_hash")
    private String passwordHash;

    @Column(nullable = false, unique = true, length = 32)
    private String nickname;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private UserRole role;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private UserStatus status;

    @Column(name = "point_balance", nullable = false)
    private int pointBalance;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    @Builder
    public User(String email, String passwordHash, String nickname) {
        this.email = email;
        this.passwordHash = passwordHash;
        this.nickname = nickname;
        this.role = UserRole.USER;
        this.status = UserStatus.ACTIVE;
        this.pointBalance = 0;
    }

    public void changeNickname(String nickname) {
        this.nickname = nickname;
    }

    public void changePassword(String encodedPassword) {
        this.passwordHash = encodedPassword;
    }

    /**
     * 회원 탈퇴 — ERD·명세 모두 soft delete(status=DELETED)를 규정한다.
     * 닉네임·이메일은 deleted_{id} 식으로 치환해 UNIQUE 자리를 비워 재가입을 막지 않는다(ERD -111).
     * 치환값은 id를 0-패딩해 27자로 만든다 — 닉네임 최대 길이(16자)를 넘겨, 사용자가 같은 값을
     * 선점(등록)해 탈퇴를 UNIQUE 충돌로 막는 공격을 구조적으로 차단한다(컬럼 32자 내, id별 유일·결정적).
     */
    public void softDelete() {
        this.status = UserStatus.DELETED;
        this.deletedAt = LocalDateTime.now();
        String tombstone = String.format("deleted_%019d", this.id);
        this.nickname = tombstone;
        this.email = tombstone;
    }

    /** 로그인 가능 상태인지. SUSPENDED·BANNED·DELETED는 로그인을 거부한다. */
    public boolean isActive() {
        return this.status == UserStatus.ACTIVE;
    }
}
