package ssafy.a706.backend.auth.oauth.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.user.entity.User;

import java.time.LocalDateTime;

/**
 * ERD v0.2 OAUTH_ACCOUNT — 한 USER에 여러 소셜 계정 연동 가능(USER ||--o{ OAUTH_ACCOUNT).
 * (provider, provider_uid)는 복합 UNIQUE로 같은 소셜 계정이 중복 연동되는 것을 막는다.
 */
@Entity
@Table(name = "oauth_account",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_oauth_provider_uid",
                columnNames = {"provider", "provider_uid"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OauthAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private OauthProvider provider;

    @Column(name = "provider_uid", nullable = false, length = 100)
    private String providerUid;

    @Column(name = "linked_at", nullable = false)
    private LocalDateTime linkedAt;

    private OauthAccount(User user, OauthProvider provider, String providerUid) {
        this.user = user;
        this.provider = provider;
        this.providerUid = providerUid;
        this.linkedAt = LocalDateTime.now();
    }

    public static OauthAccount of(User user, OauthProvider provider, String providerUid) {
        return new OauthAccount(user, provider, providerUid);
    }
}
