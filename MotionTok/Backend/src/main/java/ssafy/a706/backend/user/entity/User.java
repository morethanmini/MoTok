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

    /**
     * 닉네임을 아직 사용자가 직접 정하지 않은 상태(소셜 최초 로그인). true인 동안 nickname은
     * 사람이 쓸 수 없는 placeholder이며, 닉네임 설정을 마쳐야 정상 이용이 시작된다(-22).
     */
    @Column(name = "nickname_pending", nullable = false)
    private boolean nicknamePending;

    /**
     * 프로필 사진의 공개 URL. 미설정이면 null이고 클라이언트가 기본 아바타를 그린다.
     * key가 아니라 완성된 URL을 저장하는 이유 — path-style(MinIO)과 virtual-hosted(AWS)의
     * 주소 구조가 달라 key로부터 URL을 조립하면 환경에 따라 깨진다(StorageService.publicUrl 참고).
     */
    @Column(name = "avatar_url", length = 512)
    private String avatarUrl;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    @Builder
    public User(String email, String passwordHash, String nickname, boolean nicknamePending) {
        this.email = email;
        this.passwordHash = passwordHash;
        this.nickname = nickname;
        this.nicknamePending = nicknamePending;
        this.role = UserRole.USER;
        this.status = UserStatus.ACTIVE;
        this.pointBalance = 0;
    }

    /** 닉네임 변경 — 사용자가 직접 정한 값이므로 '설정 필요' 상태를 함께 해제한다. */
    public void changeNickname(String nickname) {
        this.nickname = nickname;
        this.nicknamePending = false;
    }

    public void changePassword(String encodedPassword) {
        this.passwordHash = encodedPassword;
    }

    /** 프로필 사진 변경. null을 주면 기본 아바타로 되돌린다. */
    public void changeAvatarUrl(String avatarUrl) {
        this.avatarUrl = avatarUrl;
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

    /**
     * 영구 정지 — 스스로 풀리지 않는 상태라 컬럼이 원천이다(기간 정지는 Redis TTL이 갖는다).
     * 탈퇴와 달리 닉네임·이메일을 치환하지 않는다: 계정은 그대로 남고 접근만 막는 제재이고,
     * 해제되면 원래 신원으로 돌아와야 한다.
     */
    public void ban() {
        this.status = UserStatus.BANNED;
    }

    /**
     * 영구 정지 해제(오판 정정). BANNED에서만 되돌린다 — 탈퇴(DELETED) 계정을 여기로 살려 내면
     * 치환된 tombstone 닉네임·이메일 그대로 로그인 가능한 계정이 된다.
     */
    public void unban() {
        if (this.status == UserStatus.BANNED) {
            this.status = UserStatus.ACTIVE;
        }
    }

    /**
     * 비밀번호가 없는 소셜 전용 계정인지.
     * 이런 계정은 '비밀번호 확인'으로 본인 확인을 할 수 없어 탈퇴 시 소셜 재인증을 요구한다(-111).
     */
    public boolean isSocialOnly() {
        return this.passwordHash == null;
    }
}
